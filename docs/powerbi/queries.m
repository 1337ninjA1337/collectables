// Collectables — analytics_events source query (Analytics #15a)
//
// Paste into Power BI Desktop:
//   Home → Transform data → (Queries pane) right-click → New Query →
//   Blank Query → Advanced Editor → replace ALL text with this file.
//
// PARAMETERS — replace the four literals below with your Supabase *session
// pooler* values: Supabase Project → Settings → Database → Connection string
// → tab "Session pooler". Power BI must authenticate as the service_role
// (Database password) because analytics_events RLS denies anon/authenticated
// (see supabase/migrations/20260508_analytics_events.sql + MANUAL-TASKS.md).
//
// Best practice: after a first successful load, promote each of the four to a
// real parameter via Home → Manage Parameters so the generated .pbit
// (Analytics #15b) can prompt for them on open instead of hard-coding.

let
    SupabaseHost   = "aws-0-<region>.pooler.supabase.com",
    SupabasePort   = "5432",
    SupabaseDb     = "postgres",
    SupabaseSchema = "public",

    Server   = SupabaseHost & ":" & SupabasePort,
    Source   = PostgreSQL.Database(Server, SupabaseDb),
    Events   = Source{[Schema = SupabaseSchema, Item = "analytics_events"]}[Data],

    // occurred_at is the date axis for every visual; name drives the funnel
    // filters in measures.dax.
    Typed    = Table.TransformColumnTypes(
        Events,
        {
            {"occurred_at", type datetimezone},
            {"name", type text}
        }
    ),

    // properties is jsonb. The npgsql provider surfaces it as text, so parse
    // it to a record; expand the per-event keys you need afterwards
    // (signup_completed → method/provider/language, listing_created →
    // mode/hasPrice, premium_activated → source, chat_opened →
    // conversationId/withFriend). Source of truth: lib/analytics-events.ts.
    Parsed   = Table.TransformColumns(
        Typed,
        {{"properties", each try Json.Document(_) otherwise null}}
    )
in
    Parsed
