import { Signal } from "@rbxts/lemon-signal";
import React, { useEffect, useRef, useState } from "@rbxts/react";
import { useProducer, useSelector } from "@rbxts/react-reflex";
import { HttpService, LogService } from "@rbxts/services";
import { ObjectControl } from "@rbxts/ui-labs/src/ControlTypings/Typing";
import { RemoveExtension } from "Hooks/Reflex/Control/ModuleList/Utils";
import { useInstance } from "Hooks/Utils/Instance";
import Configs from "Plugin/Configs";
import { WARNINGS } from "Plugin/Warnings";
import { selectPluginWidget } from "Reflex/Plugin";
import { selectClearOutputOnReload, selectStudioMode } from "Reflex/PluginSettings";
import { selectStorySelected } from "Reflex/StorySelection";
import { useStoryRequire } from "UI/StoryPreview/PreviewController/StoryRequire";
import Variants from "UI/StoryPreview/StoryActionRenders/Variants";
import { UILabsWarn } from "Utils/MiscUtils";

import HolderParenter from "./Holders/HolderParenter";
import { MountStory } from "./Mount";
import { NormalizeFoundationResult } from "./StoryCheck/FoundationNormalize";
import { CheckStory } from "./StoryCheck/StoryCheck";

interface PreviewControllerProps {
	PreviewEntry: PreviewEntry;
}

export interface RecoverControlEntry {
	RecoverType: "Control";
	Control: ObjectControl;
	Value: ControlValue;
}
export interface RecoverGroupEntry {
	RecoverType: "ControlGroup";
	Controls: Record<string, RecoverControlEntry>;
}

export type RecoverControlsData = Record<string, RecoverControlEntry | RecoverGroupEntry>;

interface MountInfo {
	Key: string;
	MountType: MountType;
	Result: MountResults[MountType];
}

const LISTENER_ZINDEX = 50;

function PreviewController(props: PreviewControllerProps) {
	const clearOutputOnReload = useSelector(selectClearOutputOnReload);
	const selectedPreview = useSelector(selectStorySelected);
	const studioMode = useSelector(selectStudioMode);
	const pluginWidget = useSelector(selectPluginWidget);

	const [canReload, setCanReload] = useState(false);
	const [result, reloader] = useStoryRequire(props.PreviewEntry, studioMode, canReload);
	const [renderer, setRenderer] = useState<{
		Key: string;
		MountType: MountType;
		Renderer: React.Element;
	}>();
	const [recoverControlsData, setRecoverControlsData] = useState<RecoverControlsData>();
	const [activeVariant, setActiveVariant] = useState<string>();
	const [variants, setVariants] = useState<string[]>();
	const mountIdRef = useRef(0);

	const entry = props.PreviewEntry;
	const key = props.PreviewEntry.Key;

	const { setMountData, setActionComponent, unsetActionComponent } = useProducer<RootProducer>();

	const mountFrame = useInstance("Frame", undefined, {
		Name: "StoryHolder",
		Size: UDim2.fromScale(1, 1),
		BackgroundTransparency: 1
	});
	const listenerFrame = useInstance("Frame", undefined, {
		Name: "UILabsInputListener",
		Size: UDim2.fromScale(1, 1),
		BackgroundTransparency: 1,
		ZIndex: LISTENER_ZINDEX
	});

	useEffect(() => {
		//Updating the reloader
		setMountData(key, { HotReloader: reloader });
	}, [reloader, key]);
	useEffect(() => {
		setMountData(key, { Holder: mountFrame, ListenerFrame: listenerFrame });
	}, [mountFrame, listenerFrame, key]);
	useEffect(() => {
		mountFrame.Visible = entry.Visible;
	}, [entry.Visible]);

	// Register/clear the Variants tab whenever variants change
	useEffect(() => {
		if (variants !== undefined && variants.size() > 1) {
			setActionComponent(key, "VariantsTab", {
				DisplayName: "Variants",
				Render: <Variants Variants={variants} Active={activeVariant} OnSelect={setActiveVariant} />,
				Order: 1
			});
			return () => {
				unsetActionComponent(key, "VariantsTab");
			};
		}
		unsetActionComponent(key, "VariantsTab");
	}, [variants, activeVariant, key]);

	// Running story
	useEffect(() => {}, [result]);

	// Creating story
	useEffect(() => {
		if (result === undefined) return;
		if (reloader === undefined) return;

		const normalized = NormalizeFoundationResult(
			result,
			activeVariant,
			props.PreviewEntry.Module,
			pluginWidget,
			reloader.GetEnvironment()
		);
		const storyInput = normalized ? normalized.Result : result;
		if (normalized) {
			setVariants(normalized.Variants);
			if (normalized.ActiveVariant !== activeVariant) setActiveVariant(normalized.ActiveVariant);
		} else {
			if (variants !== undefined) setVariants(undefined);
		}

		const check = CheckStory(storyInput);
		if (!check.Sucess) return UILabsWarn(WARNINGS.StoryTypeError, check.Error);

		mountFrame.Name = RemoveExtension(props.PreviewEntry.Module.Name, Configs.Extensions.Story);
		const unmountSignal = new Signal();
		const myMountId = ++mountIdRef.current;
		let cleaned = false;
		const cleanup = () => {
			if (cleaned) return;
			cleaned = true;
			unmountSignal.Fire();
			unmountSignal.Destroy();
		};

		if (clearOutputOnReload) {
			const isSelected = selectedPreview === props.PreviewEntry.UID || selectedPreview === props.PreviewEntry.Key;

			if (selectedPreview === undefined || isSelected) {
				LogService.ClearOutput();
			}
		}

		const gotRenderer = MountStory(
			check.Type,
			props.PreviewEntry,
			check.Result,
			mountFrame,
			listenerFrame,
			unmountSignal,
			recoverControlsData,
			setRecoverControlsData
		);
		setRenderer({
			Key: HttpService.GenerateGUID(false),
			MountType: check.Type,
			Renderer: gotRenderer
		});

		const environment = reloader.GetEnvironment();

		if (environment) {
			environment.HookOnDestroyed(() => {
				// Skip stale hooks from previous variants/mounts.
				if (myMountId !== mountIdRef.current) return;
				cleanup();
				mountFrame.ClearAllChildren();
			});
		}

		return cleanup;
	}, [result, reloader, activeVariant]);

	const renderMap: ReactChildren = new Map();
	if (renderer) renderMap.set(renderer.Key, renderer.Renderer);

	const render = (
		<React.Fragment>
			<HolderParenter
				MountFrame={mountFrame}
				ListenerFrame={listenerFrame}
				MountType={renderer?.MountType}
				Entry={entry}
				SetCanReload={setCanReload}
			/>
			{renderMap}
		</React.Fragment>
	);
	return render;
}

export default PreviewController;
