export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          caregiver_id: string | null
          created_at: string
          description: string | null
          id: string
          resolution_note: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          senior_id: string | null
          type: Database["public"]["Enums"]["alert_type"]
          visit_id: string | null
        }
        Insert: {
          caregiver_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          resolution_note?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          senior_id?: string | null
          type: Database["public"]["Enums"]["alert_type"]
          visit_id?: string | null
        }
        Update: {
          caregiver_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          resolution_note?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          senior_id?: string | null
          type?: Database["public"]["Enums"]["alert_type"]
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alerts_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_senior_id_fkey"
            columns: ["senior_id"]
            isOneToOne: false
            referencedRelation: "seniors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          dzielnice: string[] | null
          email: string | null
          id: string
          imie: string
          nazwisko: string
          telefon: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          dzielnice?: string[] | null
          email?: string | null
          id: string
          imie?: string
          nazwisko?: string
          telefon?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          dzielnice?: string[] | null
          email?: string | null
          id?: string
          imie?: string
          nazwisko?: string
          telefon?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      seniors: {
        Row: {
          adres: string
          created_at: string
          decyzja_data: string | null
          decyzja_do: string | null
          decyzja_nr: string | null
          decyzja_od: string | null
          godziny_max: number
          godziny_min: number
          id: string
          imie: string
          lat: number | null
          lng: number | null
          nazwisko: string
          nfc_uid: string | null
          notatka_techniczna: string | null
          opiekun_id: string | null
          pesel: string | null
          plan_wsparcia: Json | null
          status: Database["public"]["Enums"]["senior_status"]
          stawka_h: number
          telefon: string | null
          telefon_rodziny: string | null
          updated_at: string
        }
        Insert: {
          adres: string
          created_at?: string
          decyzja_data?: string | null
          decyzja_do?: string | null
          decyzja_nr?: string | null
          decyzja_od?: string | null
          godziny_max?: number
          godziny_min?: number
          id?: string
          imie: string
          lat?: number | null
          lng?: number | null
          nazwisko: string
          nfc_uid?: string | null
          notatka_techniczna?: string | null
          opiekun_id?: string | null
          pesel?: string | null
          plan_wsparcia?: Json | null
          status?: Database["public"]["Enums"]["senior_status"]
          stawka_h?: number
          telefon?: string | null
          telefon_rodziny?: string | null
          updated_at?: string
        }
        Update: {
          adres?: string
          created_at?: string
          decyzja_data?: string | null
          decyzja_do?: string | null
          decyzja_nr?: string | null
          decyzja_od?: string | null
          godziny_max?: number
          godziny_min?: number
          id?: string
          imie?: string
          lat?: number | null
          lng?: number | null
          nazwisko?: string
          nfc_uid?: string | null
          notatka_techniczna?: string | null
          opiekun_id?: string | null
          pesel?: string | null
          plan_wsparcia?: Json | null
          status?: Database["public"]["Enums"]["senior_status"]
          stawka_h?: number
          telefon?: string | null
          telefon_rodziny?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seniors_opiekun_id_fkey"
            columns: ["opiekun_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      visit_photos: {
        Row: {
          created_at: string
          id: string
          storage_path: string
          visit_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          storage_path: string
          visit_id: string
        }
        Update: {
          created_at?: string
          id?: string
          storage_path?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_photos_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_tasks: {
        Row: {
          completed: boolean
          completed_at: string | null
          created_at: string
          id: string
          task_name: string
          visit_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          task_name: string
          visit_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          id?: string
          task_name?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_tasks_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          caregiver_id: string | null
          created_at: string
          gps_distance_entry_m: number | null
          gps_distance_exit_m: number | null
          gps_verified_entry: boolean
          gps_verified_exit: boolean
          hours_billed: number
          id: string
          nfc_verified_entry: boolean
          nfc_verified_exit: boolean
          notes: string | null
          planned_end: string
          planned_start: string
          senior_id: string
          status: Database["public"]["Enums"]["visit_status"]
          updated_at: string
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          caregiver_id?: string | null
          created_at?: string
          gps_distance_entry_m?: number | null
          gps_distance_exit_m?: number | null
          gps_verified_entry?: boolean
          gps_verified_exit?: boolean
          hours_billed?: number
          id?: string
          nfc_verified_entry?: boolean
          nfc_verified_exit?: boolean
          notes?: string | null
          planned_end: string
          planned_start: string
          senior_id: string
          status?: Database["public"]["Enums"]["visit_status"]
          updated_at?: string
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          caregiver_id?: string | null
          created_at?: string
          gps_distance_entry_m?: number | null
          gps_distance_exit_m?: number | null
          gps_verified_entry?: boolean
          gps_verified_exit?: boolean
          hours_billed?: number
          id?: string
          nfc_verified_entry?: boolean
          nfc_verified_exit?: boolean
          notes?: string | null
          planned_end?: string
          planned_start?: string
          senior_id?: string
          status?: Database["public"]["Enums"]["visit_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_caregiver_id_fkey"
            columns: ["caregiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_senior_id_fkey"
            columns: ["senior_id"]
            isOneToOne: false
            referencedRelation: "seniors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      alert_type:
        | "gps_mismatch"
        | "nfc_mismatch"
        | "late_start"
        | "early_end"
        | "sos"
        | "missing_nfc"
      app_role: "coordinator" | "caregiver"
      senior_status: "aktywny" | "wygasa" | "nieaktywny"
      visit_status:
        | "planned"
        | "active"
        | "completed"
        | "alert"
        | "requires_verification"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_type: [
        "gps_mismatch",
        "nfc_mismatch",
        "late_start",
        "early_end",
        "sos",
        "missing_nfc",
      ],
      app_role: ["coordinator", "caregiver"],
      senior_status: ["aktywny", "wygasa", "nieaktywny"],
      visit_status: [
        "planned",
        "active",
        "completed",
        "alert",
        "requires_verification",
      ],
    },
  },
} as const
