"use client";
import type { OrganizerEnrichment } from "@/lib/organizerEnrichment";
const labels = {
  avg_heartrate: "Average heart rate (bpm)",
  max_heartrate: "Maximum heart rate (bpm)",
  elevation_gain_m: "Elevation gain (m)",
  calories: "Calories (kcal)",
  avg_cadence: "Average cadence (spm)",
};
export default function OrganizerEnrichmentEditor({
  value,
  distance,
  onChange,
}: {
  value: OrganizerEnrichment;
  distance: number;
  onChange: (value: OrganizerEnrichment) => void;
}) {
  return (
    <section className="enrichment-editor">
      <h3>Optional demo data</h3>
      <p>
        These are sample values and manual photo mappings for the demonstration.
        They do not connect a Strava account or identify people in a stock
        photo.
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={value.metrics !== null}
          onChange={(e) =>
            onChange({
              ...value,
              metrics: e.target.checked
                ? {
                    avg_heartrate: null,
                    max_heartrate: null,
                    elevation_gain_m: null,
                    calories: null,
                    avg_cadence: null,
                  }
                : null,
            })
          }
        />
        Include sample metrics
      </label>
      {value.metrics && (
        <div className="form-grid">
          {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
            <label key={key}>
              {labels[key]}
              <input
                type="number"
                min={key.includes("heartrate") ? 1 : 0}
                max={
                  key.includes("heartrate") || key === "avg_cadence"
                    ? 300
                    : key === "elevation_gain_m"
                      ? 99999.99
                      : 2147483647
                }
                step={key === "elevation_gain_m" ? "0.01" : "1"}
                value={value.metrics![key] ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    metrics: {
                      ...value.metrics!,
                      [key]:
                        e.target.value === "" ? null : Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
      <h3>Photo mappings</h3>
      <p>
        Use a public image URL from this project&apos;s race-photos bucket. Leave
        kilometer and capture time empty when unknown. Removing a mapping does
        not delete its image from Storage.
      </p>
      {value.photos.map((photo, index) => (
        <div className="photo-mapping-editor" key={index}>
          <h4>Photo {index + 1}</h4>
          <div className="form-grid">
            <label>
              Image URL
              <input
                type="url"
                required
                maxLength={2048}
                value={photo.photo_url}
                onChange={(e) =>
                  onChange({
                    ...value,
                    photos: value.photos.map((p, i) =>
                      i === index ? { ...p, photo_url: e.target.value } : p,
                    ),
                  })
                }
              />
            </label>
            <label>
              Attribution
              <input
                maxLength={200}
                value={photo.photographer ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    photos: value.photos.map((p, i) =>
                      i === index
                        ? { ...p, photographer: e.target.value || null }
                        : p,
                    ),
                  })
                }
              />
            </label>
            <label>
              Captured kilometer (optional)
              <input
                type="number"
                min={0}
                max={distance}
                step={1}
                value={photo.captured_km ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    photos: value.photos.map((p, i) =>
                      i === index
                        ? {
                            ...p,
                            captured_km:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          }
                        : p,
                    ),
                  })
                }
              />
            </label>
            <label>
              Capture timestamp with timezone (optional)
              <input
                maxLength={40}
                placeholder="2027-08-17T06:20:00+07:00"
                value={photo.captured_at ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    photos: value.photos.map((p, i) =>
                      i === index
                        ? { ...p, captured_at: e.target.value || null }
                        : p,
                    ),
                  })
                }
              />
            </label>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              onChange({
                ...value,
                photos: value.photos.filter((_, i) => i !== index),
              })
            }
          >
            Remove photo {index + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={value.photos.length >= 100}
        onClick={() =>
          onChange({
            ...value,
            photos: [
              ...value.photos,
              {
                photo_url: "",
                photographer: null,
                captured_km: null,
                captured_at: null,
              },
            ],
          })
        }
      >
        Add photo mapping
      </button>
    </section>
  );
}
