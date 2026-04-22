import React from "@rbxts/react";
import { useTheme } from "Hooks/Reflex/Use/Theme";
import Corner from "UI/Styles/Corner";
import { Detector } from "UI/Styles/Detector";
import { Div } from "UI/Styles/Div";
import TopList from "UI/Styles/List/TopList";
import Padding from "UI/Styles/Padding";
import Text from "UI/Styles/Text";

interface VariantsProps {
	Variants: string[];
	Active?: string;
	OnSelect: (variant: string) => void;
}

function Variants(props: VariantsProps) {
	const theme = useTheme();

	const entries: React.Element[] = [];
	props.Variants.forEach((name, index) => {
		const isActive = name === props.Active;
		entries.push(
			<Div key={name} LayoutOrder={index} Size={new UDim2(1, 0, 0, 28)}>
				<frame
					Size={UDim2.fromScale(1, 1)}
					BackgroundColor3={isActive ? theme.List.FrameHovered : theme.List.Frame}
					BorderSizePixel={0}
				>
					<Corner Radius={4} />
				</frame>
				<Padding PaddingX={10} />
				<Text
					Text={name}
					TextXAlignment={Enum.TextXAlignment.Left}
					TextSize={13}
					Size={UDim2.fromScale(1, 1)}
					TextColor3={theme.Text.Color}
					Weight={isActive ? "Bold" : "Regular"}
				/>
				<Detector
					Event={{
						MouseButton1Click: () => props.OnSelect(name)
					}}
				/>
			</Div>
		);
	});

	return (
		<Div key="VariantsAction">
			<Padding Padding={10} />
			<scrollingframe
				BackgroundTransparency={1}
				AutomaticCanvasSize={Enum.AutomaticSize.Y}
				CanvasSize={UDim2.fromScale(0, 0)}
				Size={UDim2.fromScale(1, 1)}
			>
				<TopList Padding={new UDim(0, 4)} />
				{entries}
			</scrollingframe>
		</Div>
	);
}

export default Variants;
