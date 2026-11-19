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
  position: number;
  bibNumber: string;
  name: string;
  officialTime: string;
  officialTimeMilliseconds: number;
  categoryName: string;
  categoryRank: number;
  categoryTotal: number;
  gender: string;
  genderRank: number;
  genderTotal: number;
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
