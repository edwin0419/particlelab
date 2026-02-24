"use client";

import { ko } from "@/i18n/ko";
import { RunArtifactsGrouped } from "@/types/domain";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface Props {
  artifacts?: RunArtifactsGrouped;
  artifactUrlResolver: (artifactId: string, index?: number) => string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR");
}

export function RunHistory({ artifacts, artifactUrlResolver }: Props) {
  if (!artifacts || artifacts.steps.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{ko.runHistory.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{ko.runHistory.empty}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader>
        <CardTitle>{ko.runHistory.title}</CardTitle>
      </CardHeader>
      <CardContent className="h-[260px] space-y-3 overflow-y-auto">
        {artifacts.steps.map((stepGroup) => (
          <div key={stepGroup.step_id} className="space-y-2">
            <div className="text-sm font-semibold">
              {ko.runHistory.step} {ko.steps.names[String(stepGroup.step_id) as keyof typeof ko.steps.names]}
            </div>
            {stepGroup.versions.map((version) => (
              <div key={`${stepGroup.step_id}-${version.version}`} className="rounded-md border border-border bg-muted/30 p-2">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  {ko.runHistory.version} {version.version}
                </div>
                <div className="space-y-2">
                  {version.artifacts.map((artifact) => (
                    <div key={artifact.id} className="rounded-md border border-border bg-card p-2 text-xs">
                      <p>
                        {ko.runHistory.type}: {ko.artifactTypes[artifact.artifact_type as keyof typeof ko.artifactTypes] ?? artifact.artifact_type}
                      </p>
                      <p>
                        {ko.runHistory.createdAt}: {formatDate(artifact.created_at)}
                      </p>
                      {artifact.files.map((file, index) => (
                        <a
                          key={`${artifact.id}-${file.path}-${index}`}
                          href={artifactUrlResolver(artifact.id, index)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {ko.runHistory.file}
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <Separator />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
