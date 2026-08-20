// Minimal JSX typing for the <model-viewer> custom element from
// @google/model-viewer. Only the attributes this app actually uses.
//
// React 19's JSX types live under React.JSX (re-exported by
// react/jsx-runtime), not the classic global `JSX` namespace, so that's
// what has to be augmented for the automatic JSX runtime to see it.
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          "camera-controls"?: boolean | "";
          "auto-rotate"?: boolean | "";
          "shadow-intensity"?: string;
          exposure?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
