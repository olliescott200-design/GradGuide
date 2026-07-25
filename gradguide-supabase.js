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

// ---------- Save a new feed post to Supabase ----------
// Called after your own moderatePost() approves the content.
async function submitPostToDb(programSlug, content) {
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
  return {
    who: "Anonymous",
    stage: "update",
    stageLabel: "Update posted",
    time: gg_timeAgo(row.created_at),
    body: escapeHtml(row.content),
    likes: 0,
    metoo: 0,
  };
}

function gg_timeAgo(iso) {
  var diff = Date.now() - new Date(iso).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}
