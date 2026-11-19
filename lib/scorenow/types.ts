export type ScoreNowPageContext = {
  competitionId: number;
  raceId: number;
  eventId: number;
  category: "5K" | "10K";
  sourceUrl: string;
  scrapedAt: string;
};

export type ScoreNowCheckpoint = {
  label: string;
  value: string;
};

export type ScoreNowResult = {
  competitionId: number;
  raceId: number;
  eventId: number;
  sourceUid: string;
  category: "5K" | "10K";
  position: number | null;
  bibNumber: string;
  name: string;
  officialTime: string | null;
  officialTimeMilliseconds: number | null;
  categoryName: string;
  categoryRank: number | null;
  categoryTotal: number | null;
  gender: string;
  genderRank: number | null;
  genderTotal: number | null;
  checkpoints: ScoreNowCheckpoint[];
  detailUrl: string;
  sourceUrl: string;
  scrapedAt: string;
};

export type ScoreNowPage = {
  declaredTotal: number;
  pageNumber: number;
  totalPages: number;
  checkpointLabels: string[];
  results: ScoreNowResult[];
};

export type ScoreNowCategoryDataset = {
  eventId: number;
  category: "5K" | "10K";
  declaredTotal: number;
  totalPages: number;
  results: ScoreNowResult[];
};

export type ScoreNowDataset = {
  competitionId: number;
  raceId: number;
  raceName: "Soekarno Run 2026";
  raceDate: "2026-02-15";
  sourceUrl: string;
  scrapedAt: string;
  totalResults: number;
  categories: ScoreNowCategoryDataset[];
};
