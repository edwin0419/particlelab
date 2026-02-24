export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[1200px] items-center justify-center p-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold">페이지를 찾을 수 없습니다.</h1>
        <p className="text-sm text-muted-foreground">주소를 다시 확인해 주세요.</p>
      </div>
    </main>
  );
}
