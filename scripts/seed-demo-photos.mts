import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const url = process.env.SUPABASE_URL, ref = process.env.SUPABASE_DEMO_PROJECT_REF;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !ref || !key || new URL(url).hostname !== `${ref}.supabase.co`) throw new Error("Dedicated demo project opt-in required.");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = await client.storage.getBucket("race-photos");
if (bucket.error) {
  const created = await client.storage.createBucket("race-photos", { public: true, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"], fileSizeLimit: 5*1024*1024 });
  if (created.error) throw new Error(`Could not create the stock-demo photo bucket (${created.error.message}).`);
} else if (!bucket.data.public) throw new Error("Existing photo bucket is private; refusing to change its access.");
const uploaded = await client.storage.from("race-photos").upload("demo-race.jpg", readFileSync("public/photos/demo-race.jpg"), { contentType: "image/jpeg", upsert: true });
if (uploaded.error) throw new Error("Demo photo upload failed.");
const photoUrl = client.storage.from("race-photos").getPublicUrl("demo-race.jpg").data.publicUrl;
const check = await fetch(photoUrl, { signal: AbortSignal.timeout(10000) });
if (!check.ok || !check.headers.get("content-type")?.includes("image/jpeg")) throw new Error("Uploaded demo photo is not usable.");
const updated = await client.from("fotoyu_photos").update({ photo_url: photoUrl })
  .in("bib_number", ["HERO-5K-001", "HERO-10K-001", "HERO-10K-002"]).eq("photographer", "Martin Vorel (CC0; demo stock)").select("id");
if (updated.error || updated.data?.length !== 3) throw new Error("Seed exactly three hero photo mappings before uploading.");
console.log("Verified shared CC0 demo race photo in Storage; three manual synthetic BIB mappings updated.");
