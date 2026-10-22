import type { AppSettings } from "@pi-desktop/shared";
import { useTranslation } from "react-i18next";
import { SettingsRow } from "../../features/settings/primitives";
import { SegmentedControl } from "../ui";

export function FileOpenTargetRows({
  settings,
  saveSettings,
}: {
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <SettingsRow title={t("settings.fileOpenTarget")} description={t("settings.fileOpenTargetDesc")}>
      <SegmentedControl
        value={settings.fileOpenTarget === "external" ? "external" : "workpanel"}
        onChange={(value) => void saveSettings({ fileOpenTarget: value })}
        options={[
          { value: "workpanel", label: t("settings.fileOpenTargetWorkpanel") },
          { value: "external", label: t("settings.fileOpenTargetExternal") },
        ]}
        label={t("settings.fileOpenTarget")}
        role="group"
      />
    </SettingsRow>
  );
}
