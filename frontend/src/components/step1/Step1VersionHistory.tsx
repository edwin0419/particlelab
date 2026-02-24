"use client";

import { StepArtifact } from "@/types/domain";
import { ko } from "@/i18n/ko";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  artifacts: StepArtifact[];
  selectedArtifactId: string | null;
  renaming: boolean;
  deleting: boolean;
  onSelect: (artifactId: string) => void;
  onRename: (artifactId: string, name: string) => Promise<void>;
  onDelete: (artifactId: string) => Promise<void>;
}

function asNumber(value: unknown): number | null {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return null;
  }
  return numberValue;
}

export function Step1VersionHistory({
  artifacts,
  selectedArtifactId,
  renaming,
  deleting,
  onSelect,
  onRename,
  onDelete,
}: Props) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{ko.step1Version.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {artifacts.length === 0 && <p className="text-sm text-muted-foreground">{ko.step1Version.empty}</p>}

        {artifacts.map((artifact) => {
          const cropBottom = asNumber(artifact.params.crop_bottom_px);
          const umPerPx = asNumber(artifact.params.um_per_px);
          const measurement =
            artifact.params.measurement && typeof artifact.params.measurement === "object"
              ? (artifact.params.measurement as Record<string, unknown>)
              : null;
          const pixelDistance = measurement ? asNumber(measurement.pixel_distance) : null;
          const realUm = measurement ? asNumber(measurement.real_um) : null;
          const versionName =
            typeof artifact.params.version_name === "string" && artifact.params.version_name.trim().length > 0
              ? artifact.params.version_name.trim()
              : `${ko.step1Version.versionPrefix} ${artifact.version}`;

          return (
            <div
              key={artifact.id}
              className={`w-full rounded-md border p-3 text-left transition ${
                selectedArtifactId === artifact.id
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <button type="button" className="text-left" onClick={() => onSelect(artifact.id)}>
                  <p className="text-sm font-semibold">{versionName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {ko.step1Version.versionNumberLabel}: {artifact.version}
                  </p>
                </button>
                <span className="text-xs text-muted-foreground">{new Date(artifact.created_at).toLocaleString("ko-KR")}</span>
              </div>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <p>
                  {ko.step1Version.cropBottomLabel}: {cropBottom == null ? "-" : `${cropBottom}px`}
                </p>
                <p>
                  {ko.step1Version.pixelDistanceLabel}: {pixelDistance == null ? "-" : `${pixelDistance.toFixed(2)}px`}
                </p>
                <p>
                  {ko.step1Version.realLengthLabel}: {realUm == null ? "-" : `${realUm.toFixed(4)}µm`}
                </p>
                <p>
                  {ko.step1Version.umPerPxLabel}: {umPerPx == null ? "-" : umPerPx.toFixed(8)}
                </p>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={renaming}
                  onClick={async () => {
                    const nextName = window.prompt(ko.step1Version.renamePrompt, versionName);
                    if (!nextName) {
                      return;
                    }
                    const trimmed = nextName.trim();
                    if (trimmed.length === 0 || trimmed === versionName) {
                      return;
                    }
                    try {
                      await onRename(artifact.id, trimmed);
                    } catch {
                      // 오류 토스트는 상위에서 처리
                    }
                  }}
                >
                  {ko.step1Version.renameButton}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deleting}
                  onClick={async () => {
                    const confirmed = window.confirm(ko.step1Version.deleteConfirm);
                    if (!confirmed) {
                      return;
                    }
                    try {
                      await onDelete(artifact.id);
                    } catch {
                      // 오류 토스트는 상위에서 처리
                    }
                  }}
                >
                  {ko.step1Version.deleteButton}
                </Button>
              </div>
            </div>
          );
        })}

        {artifacts.length > 0 && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => onSelect(artifacts[0].id)}>
            {ko.step1Version.loadLatestButton}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
