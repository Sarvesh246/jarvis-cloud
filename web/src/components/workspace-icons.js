import {
  AirplaneTilt,
  Briefcase,
  Code,
  FileText,
  Flask,
  GraduationCap,
  Heartbeat,
  HouseLine,
  PencilLine,
  Receipt,
  Scales,
  Sparkle,
  Storefront,
  UsersThree,
} from "@phosphor-icons/react";

/* One icon for each kind of person the ready-made workspaces are for, used
   on a phone by the Workroom tiles and the task sheet's heading */
const AUDIENCE_ICONS = {
  study: GraduationCap,
  career: Briefcase,
  home: HouseLine,
  money: Receipt,
  travel: AirplaneTilt,
  health: Heartbeat,
  business: Storefront,
  code: Code,
  writing: PencilLine,
  family: UsersThree,
  legal: Scales,
  research: Flask,
};

export function workspaceIcon(workspace) {
  if (workspace?.custom) return Sparkle;
  return AUDIENCE_ICONS[workspace?.audience] || FileText;
}
