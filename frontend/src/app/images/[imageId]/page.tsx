"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default function ImageDetailPage() {
  const params = useParams<{ imageId: string }>();
  const imageId = useMemo(() => params.imageId, [params.imageId]);

  const imageQuery = useQuery({
    queryKey: ["image", imageId],
    queryFn: () => api.getImage(imageId),
    enabled: Boolean(imageId),
  });

  const runsQuery = useQuery({
    queryKey: ["runs", imageId],
    queryFn: () => api.listRuns(imageId),
    enabled: Boolean(imageId),
  });

  return (
    <main className="mx-auto min-h-screen max-w-[1900px] space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">이미지 상세</h1>
          <p className="text-sm text-muted-foreground">{imageQuery.data?.filename}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link href="/">
            <Button size="sm" variant="outline" className="h-9 px-3">
              대시보드로 이동
            </Button>
          </Link>
          <ThemeToggle className="h-9 px-3" />
        </div>
      </header>

      <div className="grid grid-cols-[1fr_1fr] gap-4">
        <Card>
          <CardHeader>
            <CardTitle>업로드 이미지</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {imageQuery.isLoading && <p className="text-sm text-muted-foreground">불러오는 중입니다…</p>}
            {imageQuery.isError && <p className="text-sm text-red-600">오류가 발생했습니다</p>}

            {imageQuery.data && (
              <>
                <img
                  src={api.getImageFileUrl(imageQuery.data.id)}
                  alt="업로드 이미지"
                  className="max-h-[520px] w-full rounded-md border border-border object-contain"
                />
                <p className="text-sm text-muted-foreground">
                  해상도: {imageQuery.data.width} × {imageQuery.data.height}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>기존 분석 작업</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              업로드 직후 자동으로 1단계 작업공간이 열립니다. 아래 목록에서 기존 작업을 다시 열 수 있습니다.
            </p>

            {runsQuery.isLoading && <p className="text-sm text-muted-foreground">불러오는 중입니다…</p>}
            {runsQuery.isError && <p className="text-sm text-red-600">오류가 발생했습니다</p>}
            {runsQuery.data?.length === 0 && <p className="text-sm text-muted-foreground">생성된 런이 없습니다.</p>}

            <div className="space-y-2">
              {runsQuery.data?.map((run) => (
                <div key={run.id} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{run.name ?? "기본 런"}</p>
                      <p className="text-xs text-muted-foreground">{new Date(run.created_at).toLocaleString("ko-KR")}</p>
                    </div>
                    <Link href={`/runs/${run.id}`}>
                      <Button size="sm">작업공간 열기</Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
