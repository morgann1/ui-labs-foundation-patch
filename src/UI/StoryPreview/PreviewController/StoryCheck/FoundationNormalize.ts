import React from "@rbxts/react";
import * as ReactRoblox from "@rbxts/react-roblox";
import { Environment } from "Utils/HotReloader/Environment";

// Foundation (Hawk-style) stories return a table that may:
//   - declare sub-stories under `stories = {...}` (either as an array or dictionary)
//   - omit the `react`/`reactRoblox` library keys entirely (Hawk supplies them)
//   - rely on Hawk's StoryMiddleware to wrap each story in a FoundationProvider
//     so Foundation-styled primitives (<Text tag=...>) get tokens/theme.
// UI Labs' ReactLib mounter needs a top-level `story` function, matching
// `react`/`reactRoblox` references, and a provider-wrapped story — this
// normalizer bridges the gap.

interface FoundationNormalized {
	Result: Record<string, unknown>;
	Variants?: string[];
	ActiveVariant?: string;
}

interface VariantEntry {
	key: string;
	story?: unknown;
	name?: string;
	summary?: string;
}

interface FoundationRefs {
	React: typeof React;
	ReactRoblox: typeof ReactRoblox;
	FoundationProvider?: unknown;
	ErrorBoundary?: unknown;
}

const ERROR_BOUNDARY_SOURCE = `
local React = ...
local ErrorBoundary = React.Component:extend("UILabsStoryBoundary")

function ErrorBoundary:init()
	self:setState({ error = nil })
end

function ErrorBoundary:componentDidCatch(err, info)
	local stack = (info and info.componentStack) or ""
	warn("[UI Labs Foundation] story errored:\\n" .. tostring(err) .. "\\n" .. tostring(stack))
end

function ErrorBoundary.getDerivedStateFromError(err)
	return { error = err }
end

function ErrorBoundary:render()
	if self.state.error ~= nil then
		return React.createElement("TextLabel", {
			Size = UDim2.new(1, -16, 1, -16),
			Position = UDim2.new(0, 8, 0, 8),
			BackgroundTransparency = 1,
			TextColor3 = Color3.fromRGB(255, 110, 110),
			TextWrapped = true,
			Font = Enum.Font.Code,
			TextSize = 14,
			TextXAlignment = Enum.TextXAlignment.Left,
			TextYAlignment = Enum.TextYAlignment.Top,
			Text = "[UI Labs] story errored:\\n" .. tostring(self.state.error),
		})
	end
	return self.props.children
end

return ErrorBoundary
`;

function buildErrorBoundary(userReact: unknown): unknown | undefined {
	const [fn, loadErr] = loadstring(ERROR_BOUNDARY_SOURCE, "=UILabsStoryBoundary");
	if (fn === undefined) {
		warn("[UI Labs Foundation]: error-boundary loadstring failed: " + tostring(loadErr));
		return undefined;
	}
	const [ok, value] = pcall(fn, userReact);
	if (!ok) {
		warn("[UI Labs Foundation]: error-boundary init failed: " + tostring(value));
		return undefined;
	}
	return value;
}

function isFoundationShape(result: Record<string, unknown>): boolean {
	if (result["react"] !== undefined || result["reactRoblox"] !== undefined) return false;
	if (result["fusion"] !== undefined) return false;
	if (result["render"] !== undefined) return false;
	const hasStory = typeIs(result["story"], "function");
	const hasStories = typeIs(result["stories"], "table");
	return hasStory || hasStories;
}

// The top-level Packages folder (the one that holds user-facing stubs like
// `Packages.React`, `Packages.Foundation`) is the grandparent of `_Index`. We
// walk up from the story through `Foundation` → wally-wrapper → `_Index` →
// `Packages`. Foundation's *vendored* React/ReactRoblox stubs (at
// `_Index/Foundation/...`) can point at mismatched reconciler/shared graphs
// (e.g. jsdotlua_react paired with the old Rotriever ReactRoblox), which is
// the root cause of the "attempt to index nil with 'useState'" dispatcher
// crash. The top-level `Packages.React` / `Packages.ReactRoblox` stubs are
// the ones the user's app normally consumes, and are expected to be graph-
// consistent.
function resolveUserPackagesFolder(storyModule: ModuleScript): Instance | undefined {
	const foundation = storyModule.FindFirstAncestor("Foundation");
	if (!foundation) return undefined;
	const wallyWrapper = foundation.Parent;
	if (!wallyWrapper) return undefined;
	const indexFolder = wallyWrapper.Parent;
	if (!indexFolder || indexFolder.Name !== "_Index") return undefined;
	return indexFolder.Parent;
}

function resolveFoundationProviderModule(storyModule: ModuleScript): ModuleScript | undefined {
	const foundation = storyModule.FindFirstAncestor("Foundation");
	if (!foundation) return undefined;
	const providers = foundation.FindFirstChild("Providers");
	if (!providers) return undefined;
	const providerEntry = providers.FindFirstChild("Foundation");
	if (!providerEntry) return undefined;
	// Rojo projects with `init.lua` make the folder itself a ModuleScript.
	if (providerEntry.IsA("ModuleScript")) return providerEntry;
	const init = providerEntry.FindFirstChild("init") ?? providerEntry.FindFirstChild("FoundationProvider");
	if (init && init.IsA("ModuleScript")) return init;
	return undefined;
}

function resolveReactRefs(storyModule: ModuleScript, environment: Environment | undefined): FoundationRefs {
	const fallback: FoundationRefs = { React: React, ReactRoblox: ReactRoblox };

	const packages = resolveUserPackagesFolder(storyModule);
	if (!packages) return fallback;

	const reactModule = packages.FindFirstChild("React");
	const reactRobloxModule = packages.FindFirstChild("ReactRoblox");
	if (!reactModule || !reactModule.IsA("ModuleScript")) return fallback;
	if (!reactRobloxModule || !reactRobloxModule.IsA("ModuleScript")) return fallback;

	// React/ReactRoblox are natively required so their internal graph (Shared,
	// Reconciler, Scheduler) is a single engine-cached singleton. We also
	// pre-register these into the story's hot-reload env in StoryRequire.ts so
	// the story's `require(Packages.React)` returns the same instance.
	const [reactOk, reactResult] = pcall(() => require(reactModule as never));
	const [reactRobloxOk, reactRobloxResult] = pcall(() => require(reactRobloxModule as never));
	if (!reactOk) {
		warn("[UI Labs Foundation]: failed to require " + reactModule.GetFullName() + ": " + tostring(reactResult));
		return fallback;
	}
	if (!reactRobloxOk) {
		warn(
			"[UI Labs Foundation]: failed to require " +
				reactRobloxModule.GetFullName() +
				": " +
				tostring(reactRobloxResult)
		);
		return fallback;
	}

	// FoundationProvider, by contrast, must be loaded through the SAME env as
	// the story. Otherwise its internal graph (StyleProvider, TokensContext,
	// useTokens, OverlayProvider, …) gets a different cache than the story's
	// components — the provider sets a `TokensContext` on copy A, while the
	// story's `useTokens()` reads from copy B, gets the default `{}`, and
	// crashes with "attempt to index nil with 'StandardOut'".
	let providerResult: unknown;
	const providerModule = resolveFoundationProviderModule(storyModule);
	if (providerModule && environment) {
		const [providerOk, provider] = pcall(() => environment.LoadDependency(providerModule).expect());
		if (providerOk) {
			providerResult = provider;
		} else {
			warn(
				"[UI Labs Foundation]: failed to load " + providerModule.GetFullName() + ": " + tostring(provider)
			);
		}
	}

	return {
		React: reactResult as typeof React,
		ReactRoblox: reactRobloxResult as typeof ReactRoblox,
		FoundationProvider: providerResult
	};
}

function collectVariants(stories: unknown): VariantEntry[] | undefined {
	if (!typeIs(stories, "table")) return undefined;

	const entries: VariantEntry[] = [];
	let index = 0;
	for (const [k, sub] of pairs(stories as Record<string, unknown>)) {
		index++;
		if (!typeIs(sub, "table")) continue;
		const subRecord = sub as Record<string, unknown>;

		const subName = typeIs(subRecord["name"], "string") ? (subRecord["name"] as string) : undefined;
		// Prefer the substory's display name as the variant key; fall back to the
		// table key (which may be numeric for array-style stories) or a sequential
		// index so we always have something stable to identify the entry by.
		const variantKey = subName ?? tostring(k) ?? tostring(index);

		entries.push({
			key: variantKey,
			story: typeIs(subRecord["story"], "function") ? subRecord["story"] : undefined,
			name: subName,
			summary: typeIs(subRecord["summary"], "string") ? (subRecord["summary"] as string) : undefined
		});
	}

	// Deduplicate keys in case two substories share a display name.
	const seen = new Map<string, number>();
	for (const entry of entries) {
		const count = seen.get(entry.key);
		if (count === undefined) {
			seen.set(entry.key, 1);
		} else {
			seen.set(entry.key, count + 1);
			entry.key = `${entry.key} (${count + 1})`;
		}
	}

	return entries;
}

export function NormalizeFoundationResult(
	result: unknown,
	requestedVariant: string | undefined,
	storyModule: ModuleScript,
	overlayGui: Instance | undefined,
	environment: Environment | undefined
): FoundationNormalized | undefined {
	if (!typeIs(result, "table")) return undefined;
	const record = result as Record<string, unknown>;
	if (!isFoundationShape(record)) return undefined;

	const normalized: Record<string, unknown> = {};
	for (const [k, v] of pairs(record)) normalized[k as string] = v;

	let variantKeys: string[] | undefined;
	let activeVariant: string | undefined;

	const variantEntries = collectVariants(record["stories"]);
	if (variantEntries !== undefined) {
		variantKeys = variantEntries.map((e) => e.key);

		const requested =
			requestedVariant !== undefined ? variantEntries.find((e) => e.key === requestedVariant) : undefined;
		const active = requested ?? variantEntries[0];
		activeVariant = active?.key;

		if (active !== undefined) {
			if (active.story !== undefined) normalized["story"] = active.story;
			if (active.name !== undefined) normalized["name"] = active.name;
			if (active.summary !== undefined) normalized["summary"] = active.summary;
		}

		// `stories` has served its purpose; remove so the extra-keys check is satisfied.
		normalized["stories"] = undefined;
	}

	// Without a story function we can't mount anything — bail out so the user sees
	// the native "Key 'story' is not present" error rather than a confusing
	// React-library failure down the line.
	if (!typeIs(normalized["story"], "function")) return undefined;

	const refs = resolveReactRefs(storyModule, environment);
	normalized["react"] = refs.React;
	normalized["reactRoblox"] = refs.ReactRoblox;

	// If we resolved FoundationProvider, wrap the story in it so Foundation
	// components can read tokens/theme/etc. Using `refs.React.createElement`
	// here (not the plugin's React) ensures the wrapper element is constructed
	// by the same React singleton the story and reconciler share.
	//
	// We deliberately do *not* pass `plugin` to the provider. With it,
	// FoundationProvider mounts WidgetsProvider/PanelsProvider, which call
	// `plugin:GetPluginComponent(...)` — a method that requires the
	// RobloxScript capability. Foundation code loaded via the hot-reload env
	// from ReplicatedStorage doesn't inherit that capability, so the call
	// throws "lacking capability RobloxScript". Skipping the plugin prop
	// makes FoundationProvider render the non-Widgets branch, which is what
	// a regular (non-Hawk) runtime sees.
	//
	// We also wrap the whole thing in a minimal error boundary. React
	// explicitly recommends one for tree-level error containment; without it,
	// any crash inside a Foundation component (e.g. ReactOtter binding update
	// glitches we've seen on Slider's Interactable) unmounts the entire
	// preview tree and spams the console. The boundary catches the error,
	// logs it once with component stack, and renders a placeholder so the
	// rest of the story panel stays usable.
	if (refs.FoundationProvider !== undefined) {
		const originalStory = normalized["story"] as (props: unknown) => unknown;
		const FoundationProvider = refs.FoundationProvider as (props: unknown) => unknown;
		const createElement = refs.React.createElement as unknown as (
			component: unknown,
			props: unknown,
			...children: unknown[]
		) => unknown;
		const ErrorBoundary = buildErrorBoundary(refs.React);

		const WrappedStory = (props: unknown) => {
			const inner = createElement(originalStory, props);
			const provided = createElement(
				FoundationProvider,
				{
					theme: "Dark",
					device: "Desktop",
					overlayGui: overlayGui
				},
				inner
			);
			const guarded =
				ErrorBoundary !== undefined ? createElement(ErrorBoundary, {}, provided) : provided;
			// Foundation components use `tag="auto-xy"` etc. which auto-size to
			// their content and anchor at (0,0). Without a wrapping layout they
			// cram into the top-left of the mount frame, where the bottom
			// ActionsPanel can overlap them on hover. Wrap in a full-size Frame
			// with a centering UIListLayout so components render in the middle
			// of the preview and stay clear of the action bar.
			return createElement(
				"Frame",
				{
					Size: new UDim2(1, 0, 1, 0),
					BackgroundTransparency: 1,
					BorderSizePixel: 0
				},
				createElement("UIListLayout", {
					FillDirection: Enum.FillDirection.Vertical,
					HorizontalAlignment: Enum.HorizontalAlignment.Center,
					VerticalAlignment: Enum.VerticalAlignment.Center,
					SortOrder: Enum.SortOrder.LayoutOrder,
					Padding: new UDim(0, 8)
				}),
				guarded
			);
		};
		normalized["story"] = WrappedStory;
	}

	return { Result: normalized, Variants: variantKeys, ActiveVariant: activeVariant };
}
