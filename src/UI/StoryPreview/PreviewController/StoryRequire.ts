import { Janitor } from "@rbxts/janitor";
import { useAsync, useLatest } from "@rbxts/pretty-react-hooks";
import { useCallback, useEffect, useState } from "@rbxts/react";
import { useProducer, useSelector } from "@rbxts/react-reflex";
import { useGetInputSignalsFromFrame, useInputSignals } from "Context/UserInputContext";
import { usePlugin } from "Hooks/Reflex/Use/Plugin";
import Configs from "Plugin/Configs";
import { selectNodeFromModule } from "Reflex/Explorer/Nodes";
import { selectPluginWidget } from "Reflex/Plugin";
import { Environment } from "Utils/HotReloader/Environment";
import { HotReloader } from "Utils/HotReloader/HotReloader";
import { CreateTuple } from "Utils/MiscUtils";

import { CreateEntrySnapshot, ReloadEntry } from "../Utils";

export function useStoryRequire(entry: PreviewEntry, studioMode: boolean, canReload: boolean) {
	const plugin = usePlugin();
	const node = useSelector(selectNodeFromModule(entry.Module));
	const [reloader, setReloader] = useState<HotReloader>();
	const [reloadQuery, setReloadQuery] = useState(false);
	const [resultPromise, setResultPromise] = useState<Promise<unknown>>();
	const { unmountByUID, updateMountData } = useProducer<RootProducer>();
	const widget = useSelector(selectPluginWidget);
	const inputs = useGetInputSignalsFromFrame(entry.ListenerFrame);
	const inputSignals = useInputSignals(inputs);

	const latestInput = useLatest(inputSignals);
	const latestEntry = useLatest(entry);
	const InjectGlobalControls = useCallback(
		(environment: Environment) => {
			const pluginInjection: Record<string, unknown> = {};
			const janitor = new Janitor();
			const runtimeListeners: Array<() => void> = [];

			pluginInjection["Unmount"] = () => {
				unmountByUID(latestEntry.current.UID);
			};
			pluginInjection["Reload"] = () => {
				ReloadEntry(latestEntry.current);
			};
			pluginInjection["__RunOnRuntimeListeners__"] = () => {
				runtimeListeners.forEach((listener) => {
					listener();
				});
			};
			pluginInjection["OnRuntimeStart"] = (listener: () => void) => {
				if (pluginInjection["Runtime"] === undefined) {
					runtimeListeners.push(listener);
				} else {
					listener();
				}
			};
			pluginInjection["SetStoryHolder"] = (holder?: Instance) => {
				updateMountData(latestEntry.current.UID, (oldData) => {
					return {
						...oldData,
						OverrideHolder: holder
					};
				});
			};
			pluginInjection["CreateSnapshot"] = (name?: string) => {
				CreateEntrySnapshot(latestEntry.current, name);
			};
			pluginInjection["InputListener"] = latestInput.current;
			pluginInjection["StoryJanitor"] = janitor;
			pluginInjection["PreviewUID"] = latestEntry.current.UID;
			pluginInjection["OriginalG"] = _G;
			pluginInjection["PluginWidget"] = widget;
			pluginInjection["EnvironmentUID"] = environment.EnvironmentUID;
			pluginInjection["Plugin"] = plugin;

			environment.InjectGlobal(Configs.GlobalInjectionKey, pluginInjection);

			return () => {
				janitor.Destroy();
			};
		},
		[entry.UID, widget]
	);

	//Creating the hot reloader
	useEffect(() => {
		if (!node) return;

		const reloader = new HotReloader(node.Module);
		reloader.HookOnReload((environment) => {
			const cleanup = InjectGlobalControls(environment);
			environment.HookOnDestroyed(() => {
				cleanup();
			}, 2);
		}, 2);

		// Foundation-style stories return a table without `react`/`reactRoblox`
		// keys, so the plugin has to inject them for ReactLib to mount. We resolve
		// the user's top-level `Packages.React` / `Packages.ReactRoblox` stubs
		// (not Foundation's vendored ones, which can point at a mismatched
		// reconciler/shared graph) and pre-register their natively-required
		// results into the env cache. That way the story's own
		// `require(Packages.React)` inside the hot-reload env returns the same
		// engine-cached instance the plugin's mounter is about to use, keeping
		// the reconciler's dispatcher and the story's hooks on one Shared
		// singleton and avoiding "attempt to index nil with 'useState'".
		reloader.HookOnReload((environment) => {
			const foundation = node.Module.FindFirstAncestor("Foundation");
			if (!foundation) return;
			const wallyWrapper = foundation.Parent;
			if (!wallyWrapper) return;
			const indexFolder = wallyWrapper.Parent;
			if (!indexFolder || indexFolder.Name !== "_Index") return;
			const packages = indexFolder.Parent;
			if (!packages) return;

			// Native-require the top-level `Packages.React` / `Packages.ReactRoblox`
			// once so we know the engine-cached values.
			const topReact = packages.FindFirstChild("React");
			const topReactRoblox = packages.FindFirstChild("ReactRoblox");
			if (!topReact || !topReact.IsA("ModuleScript")) return;
			if (!topReactRoblox || !topReactRoblox.IsA("ModuleScript")) return;

			const [reactOk, reactValue] = pcall(() => require(topReact as never));
			const [robloxOk, robloxValue] = pcall(() => require(topReactRoblox as never));
			if (!reactOk || !robloxOk) return;

			// Every `Packages.React` / `Packages.ReactRoblox` stub (the top-level
			// one, Foundation's vendored one, ReactUtils's vendored one, etc.)
			// ultimately re-exports the same inner `jsdotlua_react` /
			// `jsdotlua_react-roblox` ModuleScript. We walk `Packages._Index`
			// and, for every ModuleScript whose *name* matches the known React
			// or ReactRoblox module names, natively require it and compare the
			// result to the top-level React/ReactRoblox values; any match is
			// aliased in the env cache to the same engine-cached singleton.
			// This keeps every `require` path through every stub on the same
			// React instance, closing out the "more than one copy of React"
			// dispatcher splits (CursorProvider → useRefCache, etc.).
			//
			// We filter by name to avoid naively requiring every ModuleScript
			// under `_Index` — many packages ship `.test` / `.spec` /
			// benchmark modules that error at require time (missing globals,
			// invalid package aliases, etc.), which would spam the console and
			// defeat the purpose of the walk.
			const reactNames = new Set(["React", "react"]);
			const robloxNames = new Set(["ReactRoblox", "react-roblox"]);
			const visit = (instance: Instance) => {
				for (const child of instance.GetChildren()) {
					if (child.IsA("ModuleScript")) {
						if (reactNames.has(child.Name) || robloxNames.has(child.Name)) {
							const [ok, value] = pcall(() => require(child as never));
							if (ok) {
								if (value === reactValue) environment.RegisterDependency(child, reactValue);
								else if (value === robloxValue) environment.RegisterDependency(child, robloxValue);
							}
						}
					}
					visit(child);
				}
			};
			visit(indexFolder);
			// Also register the top-level stubs in case the story's require path
			// hits one of them before anything under _Index.
			environment.RegisterDependency(topReact, reactValue);
			environment.RegisterDependency(topReactRoblox, robloxValue);
		}, 1);

		setResultPromise(reloader.Reload());
		setReloader(reloader);

		return () => {
			reloader.Destroy();
		};
	}, [entry.UID]);

	//Listen for hot reloader updates
	useEffect(() => {
		if (!node) return;
		if (!reloader) return;
		reloader.AutoReload = !studioMode && entry.AutoReload;

		const changed = reloader.OnReloadStarted.Connect((promise) => {
			setResultPromise(promise);
		});
		if (studioMode && entry.AutoReload) {
			const onReloadQuery = reloader.OnDependencyChanged.Connect(() => {
				setReloadQuery(true);
			});
			return () => {
				onReloadQuery.Disconnect();
				changed.Disconnect();
			};
		} else {
			setReloadQuery(false);
		}
		return () => changed.Disconnect();
	}, [reloader, studioMode, entry.AutoReload]);

	// Flushing queried reloads (studio mode)
	useEffect(() => {
		if (!reloader) return;
		if (!reloadQuery) return;
		if (!canReload) return;
		if (!studioMode) return;

		reloader.ScheduleReload();
		setReloadQuery(false);
	}, [reloader, reloadQuery, canReload, studioMode]);

	//Resolving promises
	const [result] = useAsync(() => {
		if (!resultPromise) return Promise.resolve(undefined);

		return resultPromise.catch((err) => {
			if (Promise.Error.is(err)) {
				warn("Story errored while required: \n\n" + err.trace);
			} else {
				warn("Story errored while required: \n\n" + tostring(err));
			}
		});
	}, [resultPromise]);

	return CreateTuple(result, reloader);
}
