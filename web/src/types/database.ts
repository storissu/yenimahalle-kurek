// Hand-written for Phase 1 to match supabase/migrations. Once the Supabase project exists,
// replace this file with generated types and keep it in sync after every migration:
//   npx supabase gen types typescript --project-id <project-ref> > src/types/database.ts
// (Generated output has the same shape, so imports keep working.)

export type UserRole = 'coach' | 'member';
export type TrainingStatus = 'scheduled' | 'cancelled' | 'completed';
export type RsvpResponse = 'attending' | 'not_attending';
export type ProgramStatus = 'draft' | 'published';
export type AttendanceStatus = 'present' | 'absent';
export type AuditCategory = 'training' | 'program' | 'attendance' | 'member' | 'settings';

export type RsvpDeadlineRule = '12' | '24' | '48' | 'evening' | 'custom';

export type NotificationType =
  | 'training_new'
  | 'training_changed'
  | 'training_cancelled'
  | 'deadline_reminder'
  | 'deadline_summary'
  | 'program_published'
  | 'program_updated';

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** One member's numbers for a calendar month (club time). rank is null without sessions. */
export interface MonthRow {
  member_id: string;
  full_name: string;
  sessions: number;
  training_days: number;
  rank: number | null;
}
/** One session of a member's history. `boat_*` is null when no published program put them in a boat. */
export interface MemberHistoryRow {
  training_id: string;
  starts_at: string;
  title: string | null;
  slot_index: number;
  boat_id: string | null;
  boat_name: string | null;
  /** When the session was (its own time, not the training's). */
  session_starts_at: string | null;
  session_ends_at: string | null;
}
/** One session two members rowed in the same boat (present both; from the published program). */
export interface SharedHistoryRow {
  training_id: string;
  starts_at: string;
  title: string | null;
  slot_index: number;
  boat_id: string;
  boat_name: string;
  session_starts_at: string | null;
  session_ends_at: string | null;
}
export interface MyMonthStatsRow {
  sessions: number;
  training_days: number;
  rank: number | null;
  participants: number;
}
export interface ExportRow {
  training_id: string;
  starts_at: string;
  slot_index: number;
  member_id: string;
  full_name: string;
  status: AttendanceStatus;
  note: string | null;
  session_starts_at: string;
  session_ends_at: string;
}
export interface TrainingCountRow {
  training_id: string;
  sessions: number;
  members: number;
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          username: string;
          role: UserRole;
          phone: string | null;
          is_active: boolean;
          must_change_password: boolean;
          /** Set when the member was deleted: the row is then an anonymous tombstone that keeps the club's history. */
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        // Clients may only update these two columns (column-level grant + coach-only RLS).
        Insert: never;
        Update: { full_name?: string; phone?: string | null };
        Relationships: [];
      };
      boats: {
        Row: {
          id: string;
          name: string;
          capacity: number;
          is_active: boolean;
          sort_order: number;
          /** Must be rowed with exactly `capacity` people (C4X = 4); enforced when a program is published. */
          requires_full_crew: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: { name: string; capacity: number; is_active?: boolean; sort_order?: number; requires_full_crew?: boolean };
        Update: { name?: string; capacity?: number; is_active?: boolean; sort_order?: number; requires_full_crew?: boolean };
        Relationships: [];
      };
      club_settings: {
        Row: {
          id: boolean;
          club_name: string;
          timezone: string;
          site_name: string;
          site_lat: number;
          site_lng: number;
          default_rsvp_lead_hours: number;
          reminder_lead_hours: number;
          wind_gust_warn_kmh: number | null;
          wave_warn_m: number | null;
          updated_at: string;
        };
        Insert: never;
        Update: {
          site_name?: string;
          site_lat?: number;
          site_lng?: number;
          default_rsvp_lead_hours?: number;
          reminder_lead_hours?: number;
          wind_gust_warn_kmh?: number | null;
          wave_warn_m?: number | null;
        };
        Relationships: [];
      };
      trainings: {
        Row: {
          id: string;
          title: string | null;
          starts_at: string;
          /** One-hour sessions. 0 = not planned yet; the program (or the attendance sheet) sets it, clients cannot. */
          slot_count: number;
          /** End of the last session; null until a program exists. Server-derived. */
          ends_at: string | null;
          rsvp_deadline: string;
          /** How the coach chose the deadline: hours before ('12' | '24' | '48'), 'evening' (20:00 the evening before) or 'custom'. */
          rsvp_deadline_rule: RsvpDeadlineRule | null;
          status: TrainingStatus;
          cancel_reason: string | null;
          notes: string | null;
          deadline_reminder_sent_at: string | null;
          deadline_summary_sent_at: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        // status / cancel_reason / created_by are not client-writable (column grants); use cancel_training().
        Insert: { title?: string | null; starts_at: string; rsvp_deadline: string; rsvp_deadline_rule?: RsvpDeadlineRule | null; notes?: string | null };
        Update: { title?: string | null; starts_at?: string; rsvp_deadline?: string; rsvp_deadline_rule?: RsvpDeadlineRule | null; notes?: string | null };
        Relationships: [];
      };
      training_responses: {
        Row: {
          training_id: string;
          member_id: string;
          response: RsvpResponse;
          note: string | null;
          responded_at: string;
          set_by_coach: boolean;
        };
        // Read-only for clients: written only through set_rsvp() / coach_set_rsvp().
        Insert: never;
        Update: never;
        Relationships: [];
      };
      training_programs: {
        Row: {
          training_id: string;
          status: ProgramStatus;
          version: number;
          weather_note: string | null;
          training_notes: string | null;
          published_at: string | null;
          published_by: string | null;
          created_at: string;
          updated_at: string;
        };
        // Read-only for clients: written only through save_program().
        Insert: never;
        Update: never;
        Relationships: [];
      };
      program_assignments: {
        /** `slot_index` identifies the session; `starts_at`/`ends_at` are ITS OWN times (every boat has its own schedule). */
        Row: { id: string; training_id: string; slot_index: number; boat_id: string; notes: string | null; starts_at: string; ends_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      program_crew: {
        Row: { assignment_id: string; training_id: string; slot_index: number; member_id: string; seat: number | null };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      attendance_records: {
        Row: {
          training_id: string;
          slot_index: number;
          member_id: string;
          status: AttendanceStatus;
          note: string | null;
          recorded_by: string;
          recorded_at: string;
          /** The time of the session this record is about (what actually happened). */
          starts_at: string;
          ends_at: string;
        };
        // Read-only for clients: written only through save_attendance().
        Insert: never;
        Update: never;
        Relationships: [];
      };
      notification_outbox: {
        Row: {
          id: string;
          user_id: string;
          type: NotificationType;
          training_id: string | null;
          title: string;
          body: string;
          url: string;
          dedupe_key: string;
          created_at: string;
          read_at: string | null;
          push_done_at: string | null;
          push_attempts: number;
          push_error: string | null;
        };
        // A user may only mark their own messages read (column grant); everything else is server-side.
        Insert: never;
        Update: { read_at?: string | null };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: number;
          at: string;
          tx: number;
          actor_id: string | null;
          actor_name: string | null;
          category: AuditCategory;
          action: string;
          entity: string;
          entity_id: string | null;
          summary: string;
          detail: Json;
        };
        // Written only by the database (triggers) and the admin Edge Functions; coaches may read it.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      weather_snapshots: {
        Row: {
          training_id: string;
          slot_index: number;
          fetched_at: string;
          source: string;
          forecast_for: string;
          temperature_c: number | null;
          apparent_c: number | null;
          wind_kmh: number | null;
          gust_kmh: number | null;
          wind_dir_deg: number | null;
          precip_prob: number | null;
          precip_mm: number | null;
          weather_code: number | null;
          cloud_pct: number | null;
          wave_height_m: number | null;
          wave_period_s: number | null;
          wave_dir_deg: number | null;
        };
        // Written only by the refresh-weather Edge Function.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
          last_success_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      member_directory: {
        Row: { id: string; full_name: string; phone: string | null };
        Relationships: [];
      };
    };
    Functions: {
      complete_password_change: { Args: never; Returns: undefined };
      cancel_training: { Args: { p_training_id: string; p_reason: string }; Returns: undefined };
      set_rsvp: { Args: { p_training_id: string; p_response: RsvpResponse; p_note?: string | null }; Returns: undefined };
      coach_set_rsvp: {
        Args: { p_training_id: string; p_member_id: string; p_response: RsvpResponse; p_note?: string | null };
        Returns: undefined;
      };
      server_now: { Args: never; Returns: string };
      save_program: { Args: { p_training_id: string; p_payload: Json; p_publish: boolean; p_notify?: boolean }; Returns: undefined };
      save_attendance: { Args: { p_training_id: string; p_rows: Json; p_complete?: boolean }; Returns: undefined };
      monthly_leaderboard: { Args: { p_month: string }; Returns: MonthRow[] };
      shared_boat_history: { Args: { p_member: string }; Returns: SharedHistoryRow[] };
      member_training_history: { Args: { p_member: string }; Returns: MemberHistoryRow[] };
      my_month_stats: { Args: { p_month: string }; Returns: MyMonthStatsRow[] };
      coach_month_table: { Args: { p_month: string }; Returns: MonthRow[] };
      attendance_export: { Args: { p_month: string }; Returns: ExportRow[] };
      training_attendance_counts: { Args: { p_training_ids: string[] }; Returns: TrainingCountRow[] };
      register_push_subscription: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string };
        Returns: undefined;
      };
    };
    Enums: { user_role: UserRole; training_status: TrainingStatus; rsvp_response: RsvpResponse; program_status: ProgramStatus };
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type Training = Database['public']['Tables']['trainings']['Row'];
export type TrainingResponse = Database['public']['Tables']['training_responses']['Row'];
export type Boat = Database['public']['Tables']['boats']['Row'];
export type TrainingProgram = Database['public']['Tables']['training_programs']['Row'];
export type ProgramAssignment = Database['public']['Tables']['program_assignments']['Row'];
export type ProgramCrew = Database['public']['Tables']['program_crew']['Row'];
export type AttendanceRecord = Database['public']['Tables']['attendance_records']['Row'];
export type AppNotification = Database['public']['Tables']['notification_outbox']['Row'];
export type AuditEntry = Omit<Database['public']['Tables']['audit_log']['Row'], 'detail'> & { detail: Record<string, unknown> };

export type WeatherSnapshot = Database['public']['Tables']['weather_snapshots']['Row'];
