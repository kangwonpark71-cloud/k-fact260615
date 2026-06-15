import { useTheme } from "@/lib/theme";

export function LiquidBackground() {
  const { theme } = useTheme();
  const isNight = theme === "night";

  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden"
    >
      {/* 배경 이미지 / 밤하늘 그라디언트 */}
      {isNight ? (
        <div
          className="absolute inset-[-8%]"
          style={{
            background:
              "radial-gradient(ellipse at 20% 50%, oklch(0.18 0.15 270 / 0.9) 0%, transparent 60%)," +
              "radial-gradient(ellipse at 80% 20%, oklch(0.15 0.18 240 / 0.8) 0%, transparent 55%)," +
              "radial-gradient(ellipse at 60% 80%, oklch(0.12 0.12 290 / 0.7) 0%, transparent 60%)," +
              "oklch(0.09 0.06 255)",
            animation: "kenburns 34s ease-in-out infinite",
            willChange: "transform",
          }}
        />
      ) : (
        <div
          className="absolute inset-[-8%] bg-cover bg-center"
          style={{
            backgroundImage: "url('/bg.png')",
            animation: "kenburns 28s ease-in-out infinite",
            willChange: "transform",
            filter: "blur(12px) brightness(0.15) saturate(1.5)",
          }}
        />
      )}

      {/* 오버레이 */}
      <div
        className="absolute inset-0"
        style={
          isNight
            ? {
                background:
                  "linear-gradient(160deg, oklch(0.09 0.1 255 / 0.5) 0%, oklch(0.07 0.08 270 / 0.35) 50%, oklch(0.1 0.12 240 / 0.45) 100%)",
                animation: "bg-shimmer 15s ease-in-out infinite",
              }
            : {
                background:
                  "linear-gradient(160deg, oklch(0.10 0.18 350 / 0.82) 0%, oklch(0.09 0.14 330 / 0.75) 50%, oklch(0.10 0.16 10 / 0.80) 100%)",
                animation: "bg-shimmer 12s ease-in-out infinite",
              }
        }
      />

      {/* 발광 오브 */}
      <div
        className="absolute rounded-full"
        style={{
          width: "60vmax",
          height: "60vmax",
          top: "-10%",
          left: "-15%",
          background: isNight
            ? "radial-gradient(circle, oklch(0.55 0.22 250 / 0.28) 0%, transparent 70%)"
            : "radial-gradient(circle, oklch(0.65 0.28 350 / 0.35) 0%, transparent 70%)",
          animation: "float-glow 22s ease-in-out infinite",
          willChange: "transform",
        }}
      />
      <div
        className="absolute rounded-full"
        style={{
          width: "50vmax",
          height: "50vmax",
          bottom: "-15%",
          right: "-10%",
          background: isNight
            ? "radial-gradient(circle, oklch(0.5 0.24 280 / 0.22) 0%, transparent 70%)"
            : "radial-gradient(circle, oklch(0.6 0.3 320 / 0.3) 0%, transparent 70%)",
          animation: "float-glow 28s ease-in-out infinite reverse",
          willChange: "transform",
        }}
      />

      {/* 밤하늘 전용: 별 파티클 레이어 */}
      {isNight && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(1px 1px at 10% 15%, oklch(0.95 0.02 245 / 0.9) 0%, transparent 100%)," +
              "radial-gradient(1px 1px at 25% 40%, oklch(0.9 0.04 240 / 0.7) 0%, transparent 100%)," +
              "radial-gradient(1.5px 1.5px at 40% 8%, oklch(0.95 0.02 245 / 0.85) 0%, transparent 100%)," +
              "radial-gradient(1px 1px at 55% 55%, oklch(0.88 0.06 250 / 0.65) 0%, transparent 100%)," +
              "radial-gradient(1.5px 1.5px at 70% 25%, oklch(0.92 0.03 245 / 0.8) 0%, transparent 100%)," +
              "radial-gradient(1px 1px at 80% 70%, oklch(0.9 0.04 240 / 0.6) 0%, transparent 100%)," +
              "radial-gradient(1px 1px at 90% 12%, oklch(0.95 0.02 245 / 0.75) 0%, transparent 100%)," +
              "radial-gradient(2px 2px at 15% 80%, oklch(0.85 0.1 240 / 0.5) 0%, transparent 100%)," +
              "radial-gradient(1px 1px at 62% 90%, oklch(0.9 0.04 245 / 0.55) 0%, transparent 100%)," +
              "radial-gradient(1.5px 1.5px at 35% 68%, oklch(0.88 0.06 250 / 0.6) 0%, transparent 100%)",
            animation: "bg-shimmer 20s ease-in-out infinite",
          }}
        />
      )}

      {/* 비네트 */}
      <div
        className="absolute inset-0"
        style={{
          background: isNight
            ? "radial-gradient(ellipse at center, transparent 25%, oklch(0.05 0.05 255 / 0.55) 100%)"
            : "radial-gradient(ellipse at center, transparent 25%, oklch(0.12 0.14 350 / 0.5) 100%)",
        }}
      />
    </div>
  );
}
