import { Printer, Download } from "lucide-react";

export function ExportActions() {
  const handlePrint = () => {
    window.print();
  };

  const handleDownloadImage = async () => {
    const el = document.getElementById("analysis-report");
    if (!el) return;

    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(el, {
        backgroundColor: "#ffffff",
        pixelRatio: 2,
        width: el.scrollWidth,
        height: el.scrollHeight,
        style: {
          transform: "none",
        },
      });
      const link = document.createElement("a");
      link.download = `factcheck-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      handlePrint();
    }
  };

  return (
    <div className="flex items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={handlePrint}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-surface-2 transition-colors"
      >
        <Printer className="w-3.5 h-3.5" />
        저장/인쇄
      </button>
      <button
        type="button"
        onClick={handleDownloadImage}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-surface-2 transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        이미지 저장
      </button>
    </div>
  );
}
