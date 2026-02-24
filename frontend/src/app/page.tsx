"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ApiError, api } from "@/lib/api";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);

  const imagesQuery = useQuery({
    queryKey: ["images"],
    queryFn: api.listImages,
    retry: 0,
  });

  const getUploadErrorMessage = (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.status === 0) {
        return "서버에 연결할 수 없습니다. 백엔드 실행 상태와 포트(8000)를 확인해 주세요.";
      }
      if (error.status === 413) {
        return "파일 크기가 너무 큽니다. 더 작은 파일을 사용해 주세요.";
      }
      if (error.status === 422) {
        return "지원하지 않는 파일 형식입니다. 이미지 파일을 확인해 주세요.";
      }
      if (error.status === 500) {
        return "서버 오류로 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.";
      }
      return error.message;
    }
    return "업로드 실패";
  };

  const getQueryErrorMessage = (error: unknown) => {
    if (error instanceof ApiError) {
      return error.message;
    }
    return "이미지 목록을 불러오지 못했습니다.";
  };

  const getRunCreateErrorMessage = (error: unknown) => {
    if (error instanceof ApiError) {
      return `작업공간 생성에 실패했습니다: ${error.message}`;
    }
    return "작업공간 생성에 실패했습니다.";
  };

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        await api.uploadImage(file);
      }
    },
    onMutate: () => toast.info("업로드 중…"),
    onSuccess: async () => {
      toast.success("업로드 완료");
      setSelectedCount(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await queryClient.invalidateQueries({ queryKey: ["images"] });
    },
    onError: (error) => toast.error(getUploadErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => api.deleteImage(imageId),
    onSuccess: () => {
      toast.success("이미지를 삭제했습니다.");
      queryClient.invalidateQueries({ queryKey: ["images"] });
    },
    onError: () => toast.error("이미지 삭제 중 오류가 발생했습니다."),
  });

  const startRunMutation = useMutation({
    mutationFn: async (imageId: string) => {
      const runs = await api.listRuns(imageId);
      if (runs.length > 0) {
        return runs[0];
      }
      return api.createRun(imageId);
    },
    onSuccess: (run) => {
      router.push(`/runs/${run.id}`);
    },
    onError: (error) => {
      toast.error(getRunCreateErrorMessage(error));
    },
  });

  const onUpload = async (event: FormEvent) => {
    event.preventDefault();
    const files = Array.from(fileInputRef.current?.files ?? []);
    if (files.length === 0) {
      toast.error("업로드할 이미지를 선택해 주세요.");
      return;
    }
    try {
      await uploadMutation.mutateAsync(files);
    } catch {
      // 오류 토스트는 onError에서 처리
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-[1900px] space-y-4 p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-4xl font-bold">대시보드</h1>
          <p className="text-lg text-muted-foreground">
            주사전자현미경 이미지를 업로드하고 1단계 스케일 보정을 시작하세요.
          </p>
        </div>
        <ThemeToggle className="h-9 px-3" />
      </header>

      <Card>
        <CardHeader>
          <CardTitle>이미지 업로드</CardTitle>
          <CardDescription>한 번에 여러 이미지를 선택할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onUpload} className="flex items-center gap-3">
            <Input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.tif,.tiff,image/png,image/jpeg,image/tiff"
              onChange={(event) => {
                setSelectedCount(event.currentTarget.files?.length ?? 0);
              }}
              onInput={(event) => {
                setSelectedCount((event.currentTarget as HTMLInputElement).files?.length ?? 0);
              }}
              className="max-w-xl"
            />
            <Button type="submit" disabled={uploadMutation.isPending}>
              이미지 업로드
            </Button>
            <span className="text-sm text-muted-foreground">선택: {selectedCount}개</span>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">참고: 파일 용량이 크면 업로드 시간이 길어질 수 있습니다.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>이미지 목록</CardTitle>
        </CardHeader>
        <CardContent>
          {imagesQuery.isLoading && <p className="text-sm text-muted-foreground">불러오는 중입니다…</p>}
          {imagesQuery.isError && (
            <div className="space-y-2">
              <p className="text-sm text-red-600">{getQueryErrorMessage(imagesQuery.error)}</p>
              <Button size="sm" variant="outline" onClick={() => imagesQuery.refetch()}>
                다시 불러오기
              </Button>
            </div>
          )}

          {imagesQuery.data && imagesQuery.data.length === 0 && (
            <p className="text-sm text-muted-foreground">업로드된 이미지가 없습니다.</p>
          )}

          <div className="grid grid-cols-4 gap-4">
            {imagesQuery.data?.map((image) => (
              <Card key={image.id} className="overflow-hidden">
                <img
                  src={api.getImageFileUrl(image.id)}
                  alt="업로드 이미지 미리보기"
                  className="h-44 w-full object-cover"
                />
                <CardContent className="space-y-2 p-3">
                  <p className="truncate text-sm font-medium">{image.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {image.width} × {image.height}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => startRunMutation.mutate(image.id)}
                      disabled={startRunMutation.isPending}
                    >
                      이미지 분석 시작
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate(image.id)}
                      disabled={deleteMutation.isPending}
                    >
                      삭제
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
