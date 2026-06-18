export function LiquidBackground() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden"
    >
      {/* 딥 네이비 정적 배경 — 문서/검증 기관 분위기 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 20% 0%, oklch(0.22 0.08 235 / 0.6) 0%, transparent 55%)," +
            "radial-gradient(ellipse at 80% 100%, oklch(0.18 0.07 245 / 0.5) 0%, transparent 55%)," +
            "oklch(0.11 0.04 235)",
        }}
      />
      {/* 미세한 노이즈 텍스처 느낌 — 종이/문서 질감 */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, oklch(1 0 0) 0px, oklch(1 0 0) 1px, transparent 1px, transparent 4px)",
        }}
      />
    </div>
  );
}
