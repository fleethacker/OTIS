import type { IconType } from "react-icons";
import {
  TbRadar,
  TbShip,
  TbSubmarine,
  TbRadio,
  TbMap2,
  TbWaveSine,
  TbClipboardList,
  TbDatabase,
  TbLink,
  TbIdBadge2,
  TbShieldCheck,
  TbBomb,
  TbRadioactive,
  TbGasStation,
  TbFileText,
} from "react-icons/tb";

const OPTASK_ICONS: Partial<Record<string, { icon: IconType; name: string }>> = {
  "OPTASK AAW": { icon: TbRadar, name: "TbRadar" },
  "OPTASK ASUW": { icon: TbShip, name: "TbShip" },
  "OPTASK ASW": { icon: TbSubmarine, name: "TbSubmarine" },
  "OPTASK COMMS": { icon: TbRadio, name: "TbRadio" },
  "OPTASK COP-CTP": { icon: TbMap2, name: "TbMap2" },
  "OPTASK EW": { icon: TbWaveSine, name: "TbWaveSine" },
  "OPTASK GENERAL": { icon: TbClipboardList, name: "TbClipboardList" },
  "OPTASK IM": { icon: TbDatabase, name: "TbDatabase" },
  "OPTASK LINK": { icon: TbLink, name: "TbLink" },
  "OPTASK LINK ID SUPP": { icon: TbIdBadge2, name: "TbIdBadge2" },
  "OPTASK MCM": { icon: TbShieldCheck, name: "TbShieldCheck" },
  "OPTASK MINING": { icon: TbBomb, name: "TbBomb" },
  "OPTASK NUC": { icon: TbRadioactive, name: "TbRadioactive" },
  "OPTASK RAS": { icon: TbGasStation, name: "TbGasStation" },
};
export function OptaskIcon({ type }: { type?: string }) {
  const Icon = OPTASK_ICONS[type ?? ""]?.icon ?? TbFileText;
  return (
    <Icon className="optask-icon" role="img" aria-label={type ?? "Message"} focusable="false" />
  );
}
