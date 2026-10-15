/* prism-react-renderer bundles the common grammars. A few that replies use
   often (shell, PowerShell, Java, C#, Ruby) come from prismjs, whose
   grammar files register themselves on a global Prism; this module makes
   that global the bundled instance before they load. */
import { Prism } from "prism-react-renderer";

globalThis.Prism = Prism;

export { Prism };
