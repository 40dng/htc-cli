// Type declarations for @opentui/react intrinsic elements
// Box, text, span, textarea are OpenTUI primitives — not HTML/SVG

declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      box: BoxProps;
      text: TextProps;
      span: SpanProps;
      textarea: TextareaProps;
    }
  }
}

interface BaseProps {
  children?: React.ReactNode;
  key?: string | number;
  ref?: unknown;
  // Layout
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  flexGrow?: number;
  flexShrink?: number;
  flexWrap?: "wrap" | "nowrap";
  alignItems?: "flex-start" | "flex-end" | "center" | "stretch";
  alignSelf?: "flex-start" | "flex-end" | "center" | "stretch" | "auto";
  justifyContent?: "flex-start" | "flex-end" | "center" | "space-between" | "space-around";
  width?: number | string;
  height?: number | string;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  padding?: number;
  paddingX?: number;
  paddingY?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  margin?: number;
  marginX?: number;
  marginY?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  overflow?: "hidden" | "visible" | "scroll";
  // Colors
  fg?: string;
  bg?: string;
  // Text style
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
  // Positioning
  position?: "relative" | "absolute";
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  zIndex?: number;
  // Interaction
  onClick?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  tabIndex?: number;
  // Misc
  placeholder?: string;
}

interface BoxProps extends BaseProps {}
interface TextProps extends BaseProps {}
interface SpanProps extends BaseProps {}

interface TextareaProps extends BaseProps {
  initialValue?: string;
  value?: string;
  onContentChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  autoFocus?: boolean;
}
