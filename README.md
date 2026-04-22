## UI Labs (Foundation Patch)

This is a fork of [UI Labs](https://github.com/PepeElToro41/ui-labs) patched so it can load and render stories from Roblox's [Foundation](https://github.com/Roblox/foundation) design system. The upstream plugin doesn't handle Foundation's Hawk-style story shape out of the box, and Foundation's packaged React graph causes a bunch of subtle issues (multiple React copies, mismatched dispatchers, missing providers) that manifest as cryptic `attempt to index nil with 'useState'` style crashes. This fork fixes those.

Everything upstream UI Labs does still works here. The patches are additive.

### What's different

- **Foundation story shape is accepted.** Modules returning `{ stories = { ... }, controls = { ... } }` without `react` / `reactRoblox` keys are recognised and mounted.
- **React singleton alignment.** Every `React` / `ReactRoblox` stub the Foundation dep graph reaches (top-level `Packages.React`, wally-vendored stubs like `_Index/Foundation/React.lua`, `_Index/ReactUtils/React.lua`, and the inner `jsdotlua_react@17.2.1/react` package) is pre-registered in the hot-reload environment to the same engine-cached instance. Fixes "more than one copy of React" dispatcher splits.
- **FoundationProvider wrapping.** The active story gets wrapped in `FoundationProvider` so tokens, theme, style contexts, and overlays all hydrate. The provider itself is loaded through the hot-reload env so its context graph shares one cache with the story.
- **Multi-story support.** `stories = { { name = "...", story = fn }, ... }` (dict or array keyed) becomes a "Variants" action tab with a picker, and the active substory's fields get lifted to the top level.
- **Array-shorthand controls.** `controls = { foo = { "a", "b", "c" } }` becomes a Choose dropdown instead of the "Malformed control object" error.
- **Centering layout.** Foundation components auto-size and anchor at (0,0) by default. The plugin wraps them in a centering `UIListLayout` so they render in the middle of the preview instead of crammed into the top-left behind the actions bar.
- **Error boundary.** A real `React.Component:extend` boundary wraps each story. If something inside a Foundation component throws, you get a red error label in place of that subtree instead of the whole preview blowing up.
- **Rebranded to "UI Labs (Foundation)"** in the toolbar, dock widget, side panel, and plugin configs so it's distinguishable from a vanilla UI Labs install.

### What's confirmed working

Tested by rendering these Foundation stories end to end, including interactive callbacks:

- Accordion
- Button / ButtonGroup
- Checkbox
- Tile

Most other Foundation components that don't depend on studio plugin APIs should work too, but haven't been individually verified.

### Known issues and warnings

- **`useCumulativeBackground` (Slider) logs noisy warnings.** The story mounts but hits a bug inside `jsdotlua_react-roblox`'s `RobloxComponentProps.removeBinding` (`attempt to call a nil value` on a nil disconnect). The error boundary catches it, so the subtree shows the red error label and the rest of the preview stays fine, but you'll see a cluster of `Warning: Error updating props on Roblox Instance` lines per render. Root cause is in React-roblox, not something fixable from this fork without monkey-patching a closed-over module local.

- **Foundation components that need `plugin:GetPluginComponent(...)` won't work.** FoundationProvider's `WidgetsProvider` / `PanelsProvider` branch requires the `RobloxScript` capability, which Foundation code loaded through ReplicatedStorage doesn't inherit. The plugin prop is intentionally not forwarded to avoid the crash, so anything that depends on those specific providers (studio-widget-integrated overlays, plugin panels) won't render correctly. Regular Foundation components (View, Text, Button, Dialog, etc.) don't hit this branch.

- **Not on the Creator Store.** This fork is GitHub-only. Build it locally or grab the rbxm from the releases page if one exists.

- **Foundation's Packages graph has to be correct.** The fix relies on `Packages.React` resolving to `jsdotlua_react` and on the inner `_Index` tree being walkable. If a user's project uses a non-standard Packages layout or mixes React versions in unusual ways, the alignment may not cover every stub and you can get the original `useState` crash back.

- **Not all Foundation stories have been tested.** If you find one that breaks, the error boundary should at least contain the crash; open an issue with the stack trace and I can look.

- **Upstream UI Labs features aren't regression-tested.** The patches are written to be additive, and a manual sanity pass on a few React stories works, but the full upstream test matrix hasn't been re-run.

### Relationship to upstream

Upstream is at [PepeElToro41/ui-labs](https://github.com/PepeElToro41/ui-labs). If the Foundation shape eventually gets supported there, this fork should go away. Until then, bug reports specific to Foundation support belong here; general UI Labs issues belong upstream.

### Find the plugin

- [GitHub (this fork)](https://github.com/morgann1/ui-labs-foundation-patch)
- Upstream [Roblox Store](https://create.roblox.com/store/asset/14293316215/UI-Labs) and [GitHub](https://github.com/PepeElToro41/ui-labs/releases) for the unpatched version

### Upstream documentation

- [UI Labs documentation](https://pepeeltoro41.github.io/ui-labs/) (still applies for everything unrelated to Foundation)
- [UI Labs utility package](https://github.com/PepeElToro41/ui-labs-utils)

### Community

- [UI Labs DevForum post](https://devforum.roblox.com/t/ui-labs-modern-storybook-plugin-for-roblox/3109174)
- [Roblox OSS Discord](https://discord.com/invite/Qm3JNyEc32)

### Contributing

- Upstream [Contributing Guide](https://github.com/PepeElToro41/ui-labs/blob/main/CONTRIBUTING.md) applies for non-Foundation changes.
- For Foundation-specific fixes, open a PR against this fork.
