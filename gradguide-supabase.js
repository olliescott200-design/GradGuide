// GradGuide — Supabase integration (live feed only)
// Include AFTER the Supabase CDN script, before the closing </body>:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// <script src="gradguide-supabase.js"></script>

const SUPABASE_URL = "https://ldiypidklbvglnflteme.supabase.co";
const SUPABASE_KEY = "sb_publishable_WOsXm-eiOxqGgToB_7HnCQ_crT-S9ws";

const gg_supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- Load approved feed posts for a program (by slug, e.g. "goldman") ----------
async function loadPosts(programSlug) {
  try {
    const { data: program, error: programErr } = await gg_supabase
      .from("programs")
      .select("id")
      .eq("slug", programSlug)
      .single();

    if (programErr || !program) {
      console.warn("GradGuide: program not seeded in Supabase yet:", programSlug);
      return [];
    }

    const { data, error } = await gg_supabase
      .from("posts")
      .select("*")
      .eq("program_id", program.id)
      .eq("approved", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("GradGuide: error loading posts:", error);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("GradGuide: loadPosts failed:", e);
    return [];
  }
}

// ---------- Save a new post to Supabase ----------
// Called after your own moderatePost() approves the content.
// category is one of "feed" | "process" | "questions" | "reviews".
// rating (1-5) only applies when category === "reviews".
// stageName only applies when category === "process" — the specific stage
// this report is about (e.g. "HireVue Video Interview"), so reports can be
// grouped per-company instead of forced into one generic list of stages.
async function submitPostToDb(programSlug, content, university, wamRange, category, rating, stageName) {
  try {
    const { data: program, error: programErr } = await gg_supabase
      .from("programs")
      .select("id")
      .eq("slug", programSlug)
      .single();

    if (programErr || !program) {
      console.error("GradGuide: program not found for slug:", programSlug);
      return { success: false, error: "Program not set up in database yet" };
    }

    // approved:true because the content was already moderated client-side
    // before this function is called. Anyone calling the API directly could
    // bypass that check — fine for an MVP, but worth knowing.
    const { error } = await gg_supabase.from("posts").insert({
      program_id: program.id,
      content: content,
      university: university || null,
      wam_range: wamRange || null,
      category: category || "feed",
      rating: rating || null,
      stage_name: stageName || null,
      approved: true,
    });

    if (error) {
      console.error("GradGuide: error saving post:", error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {
    console.error("GradGuide: submitPostToDb failed:", e);
    return { success: false, error: e.message };
  }
}

// ---------- Turn a raw database row into the feed-item shape the site uses ----------
function formatDbPost(row) {
  var who = row.university
    ? row.university + (row.wam_range ? " \u00b7 WAM " + row.wam_range : "")
    : "Anonymous";
  return {
    who: who,
    stage: "update",
    stageLabel: "Update posted",
    time: gg_timeAgo(row.created_at),
    body: escapeHtml(row.content),
    likes: 0,
    metoo: 0,
  };
}

function gg_whoTag(row) {
  return row.university
    ? row.university + (row.wam_range ? " \u00b7 WAM " + row.wam_range : "")
    : "Anonymous";
}

// ---------- Format a community-submitted process step for the Process tab ----------
function formatDbProcessEntry(row) {
  return {
    who: gg_whoTag(row),
    time: gg_timeAgo(row.created_at),
    body: escapeHtml(row.content),
    stageName: row.stage_name || "Other",
  };
}

// ---------- Format a community-submitted interview question for the Questions tab ----------
function formatDbQuestionEntry(row) {
  return {
    q: escapeHtml(row.content),
    who: gg_whoTag(row),
  };
}

// ---------- Format a community-submitted review for the Reviews tab ----------
function formatDbReviewEntry(row) {
  return {
    who: gg_whoTag(row),
    stars: row.rating || 0,
    text: escapeHtml(row.content),
  };
}

// ---------- Turn a free-typed company name into a URL-safe slug ----------
function slugifyCompany(name) {
  var slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "company";
}

// ---------- Load every program row from Supabase (used to merge into the homepage grid) ----------
async function loadAllPrograms() {
  try {
    const { data, error } = await gg_supabase.from("programs").select("*").order("company");
    if (error) {
      console.error("GradGuide: error loading programs:", error);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("GradGuide: loadAllPrograms failed:", e);
    return [];
  }
}

// ---------- Find a program by company name, or create it if it doesn't exist yet ----------
// This is what lets someone post about a company that isn't one of the 11 pre-built pages.
async function createOrGetProgram(companyName, forcedSlug) {
  var slug = forcedSlug || slugifyCompany(companyName);
  try {
    const { data: existing } = await gg_supabase
      .from("programs")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (existing) return existing;

    const { data: created, error: insertErr } = await gg_supabase
      .from("programs")
      .insert({ company: companyName, role: "Graduate Program", slug: slug, industry: "Other" })
      .select()
      .single();

    if (insertErr) {
      // Someone else may have just created the same company — re-check before giving up.
      const { data: retry } = await gg_supabase
        .from("programs")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (retry) return retry;
      console.error("GradGuide: error creating program:", insertErr);
      return null;
    }
    return created;
  } catch (e) {
    console.error("GradGuide: createOrGetProgram failed:", e);
    return null;
  }
}

// Merge any Supabase-only programs (posted by users, not in the hardcoded 11) into the
// homepage grid. Runs once the page has fully loaded, after index.html's own script
// has already defined `programs`, `renderCards`, and `makeLocalProgramFromDb`.
window.addEventListener("load", function () {
  if (typeof loadDynamicPrograms === "function") {
    loadDynamicPrograms();
  }
});

function gg_timeAgo(iso) {
  var diff = Date.now() - new Date(iso).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}
