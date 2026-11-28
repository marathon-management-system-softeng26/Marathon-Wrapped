export type OfficialDistance = "5K" | "10K";

export type OfficialResultStatus = "finished" | "dnf" | "dns" | "dq" | "unknown";

export type OfficialCheckpoint = {
  sequence: number;
  label: string;
  distanceMeters: number | null;
  displayedTimeMs: number | null;
  reportedSplitMs: number | null;
  referenceLabel: string | null;
  isMock?: boolean;
};

export type OfficialResultInput = {
  sourceUid: string | null;
  sourceUrl: string | null;
  bib: string;
  name: string;
  distance: OfficialDistance;
  gender: string | null;
  division: string | null;
  status: OfficialResultStatus;
  finishTimeMs: number | null;
  netTimeMs: number | null;
  mockFinishTimeMs?: number | null;
  mockNetTimeMs?: number | null;
  overallRank: number | null;
  divisionRank: number | null;
  genderRank: number | null;
  checkpoints: OfficialCheckpoint[];
};

export type OfficialRecap = Omit<OfficialResultInput, "sourceUid"> & {
  runnerId: string;
  eventId: number;
};

export type StoredOfficialResult = OfficialRecap;

export type BibMatch = Pick<OfficialRecap, "runnerId" | "bib" | "name" | "distance">;
