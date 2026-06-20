// ── 공유 타입 정의 (클라이언트 + 서버 공통) ──
// 중복 선언 방지: AuditTrailPanel, external-factcheck.server, pipeline.server가 모두 이 파일에서 import

export type PropagandaTechnique = {
  name: string;
  evidence: string;
};

export type StyleClassification = {
  fake_probability: number;
  credibility_score: number;
  style_category: string;
  tone: string;
  propaganda_techniques: PropagandaTechnique[];
  signals: string[];
  linguistic_features: {
    sentence_complexity: number;
    vocabulary_richness: number;
    argument_coherence: number;
    source_attribution: number;
    emotional_density: number;
  };
  deception_risk: {
    emotional_manipulation: number;
    urgency_framing: number;
    unverified_statistics: number;
    polarizing_language: number;
  };
  reasoning: string;
};

export type ExternalFactCheck = {
  claim_text: string;
  claimant: string;
  rating: string;
  publisher: string;
  review_url: string;
  review_date?: string;
};
