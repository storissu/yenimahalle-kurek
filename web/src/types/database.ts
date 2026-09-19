// Hand-written for Phase 1 to match supabase/migrations. Once the Supabase project exists,
// replace this file with generated types and keep it in sync after every migration:
//   npx supabase gen types typescript --project-id <project-ref> > src/types/database.ts
// (Generated output has the same shape, so imports keep working.)

export type UserRole = 'coach' | 'member';

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
          created_at: string;
          updated_at: string;
        };
        Insert: { name: string; capacity: number; is_active?: boolean; sort_order?: number };
        Update: { name?: string; capacity?: number; is_active?: boolean; sort_order?: number };
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
          wind_gust_warn_kmh?: number | null;
          wave_warn_m?: number | null;
        };
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
        Row: { id: string; full_name: string };
        Relationships: [];
      };
    };
    Functions: {
      complete_password_change: { Args: never; Returns: undefined };
      register_push_subscription: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string };
        Returns: undefined;
      };
    };
    Enums: { user_role: UserRole };
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database['public']['Tables']['profiles']['Row'];
