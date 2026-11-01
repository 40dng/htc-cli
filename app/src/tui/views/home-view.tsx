import { useTerminalDimensions } from "@opentui/react";
import { useEffect, useState } from "react";
import { sortearTagline } from "../utils/taglines";
import {
	AutocompleteDropdown,
	type AutocompleteDropdownProps,
	DROPDOWN_MAX_HEIGHT,
} from "../components/autocomplete-dropdown";
import { InputBar, type TextareaHandle } from "../components/input-bar";
import {
	resolveModelDisplayName,
	resolveModelMaxInputTokens,
	StatusBar,
} from "../components/status-bar";
import { useSession } from "../contexts/session-context";
import { useTheme } from "../hooks/use-theme";
import {
	getInputRuleColor,
	getModeInputForeground,
	getModeInputPlaceholder,
} from "../palette";
import { getThemeModeAccent } from "../themes";
import { HOME_VIEW_MAX_WIDTH, type TuiProps } from "../types";

export function HomeView(props: {
	config: TuiProps["config"];
	inputValue: string;
	inputKey: number;
	onSubmit: () => void;
	onContentChange: (text: string) => void;
	onImagePaste: (dataUrl: string) => string;
	onLargeTextPaste: (text: string) => string;
	onInputFocusRequest?: () => void;
	repoStatus: {
		branch: string | null;
		diffStats: {
			files: number;
			additions: number;
			deletions: number;
		} | null;
	};
	textareaRef?: React.MutableRefObject<TextareaHandle | null>;
	autocomplete?: AutocompleteDropdownProps;
	onToggleMode: () => void;
}) {
	const {
		config,
		inputValue,
		inputKey,
		onSubmit,
		onContentChange,
		onImagePaste,
		onLargeTextPaste,
		repoStatus,
	} = props;
	const session = useSession();
	const { width } = useTerminalDimensions();
	// Tagline: fixa por sessao, troca a cada 5s (nao a cada re-render).
	const [tagline, setTagline] = useState(() => sortearTagline());
	useEffect(() => {
		const id = setInterval(() => setTagline(sortearTagline()), 5000);
		return () => clearInterval(id);
	}, []);
	const [inputCursor, setInputCursor] = useState<{
		visualCol: number;
		visualRow: number;
	} | null>(null);

	const theme = useTheme();
	const terminalBg = theme.background;
	const accent = getThemeModeAccent(theme, session.uiMode);
	const inputRuleColor = getInputRuleColor(terminalBg);
	const inputForeground = getModeInputForeground(session.uiMode, terminalBg);
	const inputPlaceholder = getModeInputPlaceholder(session.uiMode, terminalBg);
	const placeholder =
		session.uiMode === "plan" ? "Plan something..." : "What can I do for you?";
	const modelDisplayName = resolveModelDisplayName(config);
	const maxInputTokens = resolveModelMaxInputTokens(config);
	const hasAutocomplete =
		props.autocomplete?.mode && props.autocomplete.options.length > 0;
	const contentWidth = Math.min(width, HOME_VIEW_MAX_WIDTH);

	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			alignItems="center"
			justifyContent="center"
		>
            <box flexDirection="column" alignItems="center" marginTop={1} marginBottom={1} flexShrink={0}>
                <text fg="#FF5C7A">{"  ██╗  ██╗████████╗ ██████╗ "}</text>
                <text fg="#F04E6D">{"  ██║  ██║╚══██╔══╝██╔════╝ "}</text>
                <text fg="#E04060">{"  ███████║   ██║   ██║      "}</text>
                <text fg="#D03353">{"  ██╔══██║   ██║   ██║      "}</text>
                <text fg="#C02848">{"  ██║  ██║   ██║   ╚██████╗ "}</text>
                <text fg="#A81E3B">{"  ╚═╝  ╚═╝   ╚═╝    ╚═════╝ "}</text>
                <text fg="gray">{tagline}</text>
            </box>
            <box marginBottom={1} flexShrink={0}>
                <text fg="gray">
                    <em>Use / para comandos, @ para arquivos, Ctrl+P para o menu</em>
                </text>
            </box>
			<box flexDirection="column" width={contentWidth} flexShrink={0}>
				<InputBar
					accent={accent}
					ruleColor={inputRuleColor}
					inputForeground={inputForeground}
					inputPlaceholder={inputPlaceholder}
					placeholder={placeholder}
					initialValue={inputValue}
					inputKey={inputKey}
					onSubmit={onSubmit}
					onContentChange={onContentChange}
					onVisualCursorChange={setInputCursor}
					onImagePaste={onImagePaste}
					onLargeTextPaste={onLargeTextPaste}
					onFocusRequest={props.onInputFocusRequest}
					textareaRef={props.textareaRef}
				/>

				<box flexDirection="column" height={DROPDOWN_MAX_HEIGHT + 1}>
					{hasAutocomplete && props.autocomplete ? (
						<AutocompleteDropdown
							{...props.autocomplete}
							accent={accent}
							containerWidth={Math.min(width, HOME_VIEW_MAX_WIDTH)}
						/>
					) : (
						<box marginTop={1}>
							<StatusBar
								providerId={config.providerId}
								modelId={modelDisplayName}
								totalTokens={session.lastTotalTokens}
								totalCost={session.lastTotalCost}
								maxInputTokens={maxInputTokens}
								uiMode={session.uiMode}
								autoApproveAll={session.autoApproveAll}
								workspaceName={
									config.workspaceRoot
										? (config.workspaceRoot.split("/").pop() ?? "")
										: ""
								}
								gitBranch={repoStatus.branch}
								gitDiffStats={repoStatus.diffStats}
								onToggleMode={props.onToggleMode}
								variant="home"
							/>
						</box>
					)}
				</box>
			</box>
		</box>
	);
}
