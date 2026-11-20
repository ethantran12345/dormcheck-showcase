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
      academic_terms: {
        Row: {
          code: string
          created_at: string
          ends_at: string
          id: string
          name: string
          starts_at: string
          university_id: string
        }
        Insert: {
          code: string
          created_at?: string
          ends_at: string
          id?: string
          name: string
          starts_at: string
          university_id: string
        }
        Update: {
          code?: string
          created_at?: string
          ends_at?: string
          id?: string
          name?: string
          starts_at?: string
          university_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_terms_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_campaigns: {
        Row: {
          advertiser_id: string
          created_at: string
          end_date: string | null
          flat_price_cents: number | null
          id: string
          name: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string | null
          status: string
          targeting: Json
          university_id: string
          updated_at: string
        }
        Insert: {
          advertiser_id: string
          created_at?: string
          end_date?: string | null
          flat_price_cents?: number | null
          id?: string
          name: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string | null
          status?: string
          targeting?: Json
          university_id: string
          updated_at?: string
        }
        Update: {
          advertiser_id?: string
          created_at?: string
          end_date?: string | null
          flat_price_cents?: number | null
          id?: string
          name?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string | null
          status?: string
          targeting?: Json
          university_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaigns_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_creatives: {
        Row: {
          body: string | null
          campaign_id: string
          cta_text: string
          cta_url: string
          headline: string
          id: string
          image_url: string | null
          updated_at: string
        }
        Insert: {
          body?: string | null
          campaign_id: string
          cta_text?: string
          cta_url: string
          headline: string
          id?: string
          image_url?: string | null
          updated_at?: string
        }
        Update: {
          body?: string | null
          campaign_id?: string
          cta_text?: string
          cta_url?: string
          headline?: string
          id?: string
          image_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_creatives_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_impressions: {
        Row: {
          campaign_id: string
          created_at: string
          id: number
          kind: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: never
          kind: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: never
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_impressions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          target_id: string | null
          target_type: string
          university_id: string | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          target_id?: string | null
          target_type: string
          university_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          target_id?: string | null
          target_type?: string
          university_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_email_log: {
        Row: {
          admin_id: string
          id: string
          kind: string
          sent_at: string
        }
        Insert: {
          admin_id: string
          id?: string
          kind: string
          sent_at?: string
        }
        Update: {
          admin_id?: string
          id?: string
          kind?: string
          sent_at?: string
        }
        Relationships: []
      }
      admin_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
          university_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          university_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
          university_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_invitations_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      advertiser_invitations: {
        Row: {
          accepted_at: string | null
          business_name: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          business_name?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          business_name?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
        }
        Relationships: []
      }
      advertisers: {
        Row: {
          business_name: string
          category: string | null
          contact_email: string
          created_at: string
          id: string
          user_id: string
          website: string | null
        }
        Insert: {
          business_name: string
          category?: string | null
          contact_email: string
          created_at?: string
          id?: string
          user_id: string
          website?: string | null
        }
        Update: {
          business_name?: string
          category?: string | null
          contact_email?: string
          created_at?: string
          id?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      agent_activity: {
        Row: {
          agent_name: string | null
          at: string
          branch: string | null
          detail: string | null
          id: number
          session_label: string
          tool: string | null
        }
        Insert: {
          agent_name?: string | null
          at?: string
          branch?: string | null
          detail?: string | null
          id?: never
          session_label: string
          tool?: string | null
        }
        Update: {
          agent_name?: string | null
          at?: string
          branch?: string | null
          detail?: string | null
          id?: never
          session_label?: string
          tool?: string | null
        }
        Relationships: []
      }
      amazon_product_variations: {
        Row: {
          affiliate_link: string
          asin: string | null
          created_at: string
          dimension: string
          id: string
          image_url: string | null
          is_synthetic: boolean
          label: string
          position: number
          price: number | null
          product_id: string
        }
        Insert: {
          affiliate_link: string
          asin?: string | null
          created_at?: string
          dimension?: string
          id?: string
          image_url?: string | null
          is_synthetic?: boolean
          label: string
          position?: number
          price?: number | null
          product_id: string
        }
        Update: {
          affiliate_link?: string
          asin?: string | null
          created_at?: string
          dimension?: string
          id?: string
          image_url?: string | null
          is_synthetic?: boolean
          label?: string
          position?: number
          price?: number | null
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amazon_product_variations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "amazon_products"
            referencedColumns: ["id"]
          },
        ]
      }
      amazon_products: {
        Row: {
          affiliate_link: string
          category: string
          created_at: string | null
          hearts: number | null
          id: string
          image_url: string | null
          image_urls: string[] | null
          is_trending: boolean | null
          name: string
          offers: Json | null
          parent_id: string | null
          price: number
          provider: string
          rating: number | null
          review_count: number | null
          updated_at: string | null
          variant_dimension: string | null
          variant_label: string | null
          variants: Json | null
        }
        Insert: {
          affiliate_link: string
          category: string
          created_at?: string | null
          hearts?: number | null
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          is_trending?: boolean | null
          name: string
          offers?: Json | null
          parent_id?: string | null
          price: number
          provider?: string
          rating?: number | null
          review_count?: number | null
          updated_at?: string | null
          variant_dimension?: string | null
          variant_label?: string | null
          variants?: Json | null
        }
        Update: {
          affiliate_link?: string
          category?: string
          created_at?: string | null
          hearts?: number | null
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          is_trending?: boolean | null
          name?: string
          offers?: Json | null
          parent_id?: string | null
          price?: number
          provider?: string
          rating?: number | null
          review_count?: number | null
          updated_at?: string | null
          variant_dimension?: string | null
          variant_label?: string | null
          variants?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "amazon_products_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "amazon_products"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          created_at: string
          event_name: string
          event_properties: Json
          id: string
          session_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_name: string
          event_properties?: Json
          id?: string
          session_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_name?: string
          event_properties?: Json
          id?: string
          session_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      api_rate_limits: {
        Row: {
          bucket_key: string
          count: number
          window_start: string
        }
        Insert: {
          bucket_key: string
          count?: number
          window_start?: string
        }
        Update: {
          bucket_key?: string
          count?: number
          window_start?: string
        }
        Relationships: []
      }
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_users_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_users_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_templates: {
        Row: {
          body: string
          category: string
          created_at: string
          created_by: string | null
          default_audience_detail: Json
          default_audience_type: string | null
          id: string
          name: string
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          category?: string
          created_at?: string
          created_by?: string | null
          default_audience_detail?: Json
          default_audience_type?: string | null
          id?: string
          name: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          default_audience_detail?: Json
          default_audience_type?: string | null
          id?: string
          name?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      building_chat_link_reports: {
        Row: {
          created_at: string
          id: string
          link_id: string
          reason: string | null
          reporter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          link_id: string
          reason?: string | null
          reporter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          link_id?: string
          reason?: string | null
          reporter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_chat_link_reports_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "building_chat_links"
            referencedColumns: ["id"]
          },
        ]
      }
      building_chat_links: {
        Row: {
          academic_year: string
          building_id: number
          created_at: string
          floor: string | null
          id: string
          label: string | null
          platform: string
          submitted_by: string | null
          university_id: string | null
          updated_at: string
          url: string
        }
        Insert: {
          academic_year: string
          building_id: number
          created_at?: string
          floor?: string | null
          id?: string
          label?: string | null
          platform: string
          submitted_by?: string | null
          university_id?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          academic_year?: string
          building_id?: number
          created_at?: string
          floor?: string | null
          id?: string
          label?: string | null
          platform?: string
          submitted_by?: string | null
          university_id?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_chat_links_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "master_housing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "building_chat_links_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      buildings: {
        Row: {
          abbr: string
          address: string | null
          building_number: string | null
          campus: string
          city: string | null
          created_at: string
          id: string
          is_subleasable: boolean
          kind: string
          lat: number | null
          lng: number | null
          name: string
          university_id: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          abbr: string
          address?: string | null
          building_number?: string | null
          campus?: string
          city?: string | null
          created_at?: string
          id?: string
          is_subleasable?: boolean
          kind?: string
          lat?: number | null
          lng?: number | null
          name: string
          university_id?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          abbr?: string
          address?: string | null
          building_number?: string | null
          campus?: string
          city?: string | null
          created_at?: string
          id?: string
          is_subleasable?: boolean
          kind?: string
          lat?: number | null
          lng?: number | null
          name?: string
          university_id?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "buildings_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      bus_stops: {
        Row: {
          direction: string | null
          mode: string | null
          objectID: number
          route_filter: string | null
          route_sort: string | null
          routes: string | null
          stop_code: number | null
          stop_id: string | null
          stop_lat: number | null
          stop_lon: number | null
          stop_name: string | null
          stop_route: string | null
          svc_days: string | null
        }
        Insert: {
          direction?: string | null
          mode?: string | null
          objectID: number
          route_filter?: string | null
          route_sort?: string | null
          routes?: string | null
          stop_code?: number | null
          stop_id?: string | null
          stop_lat?: number | null
          stop_lon?: number | null
          stop_name?: string | null
          stop_route?: string | null
          svc_days?: string | null
        }
        Update: {
          direction?: string | null
          mode?: string | null
          objectID?: number
          route_filter?: string | null
          route_sort?: string | null
          routes?: string | null
          stop_code?: number | null
          stop_id?: string | null
          stop_lat?: number | null
          stop_lon?: number | null
          stop_name?: string | null
          stop_route?: string | null
          svc_days?: string | null
        }
        Relationships: []
      }
      business_listings: {
        Row: {
          banner_color: string | null
          banner_image_url: string | null
          business_name: string
          category: string
          created_at: string | null
          description: string
          id: string
          instagram_handle: string | null
          is_active: boolean | null
          is_approved: boolean | null
          logo_url: string | null
          packages: Json | null
          price_range: string | null
          seller_instagram_handle: string | null
          seller_snapchat_handle: string | null
          show_seller_instagram: boolean | null
          show_seller_snapchat: boolean | null
          tags: string[] | null
          university_id: string | null
          updated_at: string | null
          user_id: string
          website_url: string | null
        }
        Insert: {
          banner_color?: string | null
          banner_image_url?: string | null
          business_name: string
          category: string
          created_at?: string | null
          description: string
          id?: string
          instagram_handle?: string | null
          is_active?: boolean | null
          is_approved?: boolean | null
          logo_url?: string | null
          packages?: Json | null
          price_range?: string | null
          seller_instagram_handle?: string | null
          seller_snapchat_handle?: string | null
          show_seller_instagram?: boolean | null
          show_seller_snapchat?: boolean | null
          tags?: string[] | null
          university_id?: string | null
          updated_at?: string | null
          user_id: string
          website_url?: string | null
        }
        Update: {
          banner_color?: string | null
          banner_image_url?: string | null
          business_name?: string
          category?: string
          created_at?: string | null
          description?: string
          id?: string
          instagram_handle?: string | null
          is_active?: boolean | null
          is_approved?: boolean | null
          logo_url?: string | null
          packages?: Json | null
          price_range?: string | null
          seller_instagram_handle?: string | null
          seller_snapchat_handle?: string | null
          show_seller_instagram?: boolean | null
          show_seller_snapchat?: boolean | null
          tags?: string[] | null
          university_id?: string | null
          updated_at?: string | null
          user_id?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_listings_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_item_claims: {
        Row: {
          created_at: string | null
          item_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          item_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          item_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_item_claims_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string | null
          description: string | null
          estimated_price: number | null
          group_id: string | null
          icon_name: string | null
          id: string
          image_url: string | null
          is_checked: boolean | null
          is_custom: boolean | null
          is_night_one: boolean
          item: string
          link: string | null
          link_image: string | null
          link_title: string | null
          needs_purchase: boolean | null
          note: string | null
          order_index: number | null
          position: number | null
          split_cost: boolean | null
          split_participant_ids: string[] | null
          split_percentages: Json | null
          status: string | null
          user_id: string
          variant_label: string | null
        }
        Insert: {
          assigned_to?: string | null
          category: string
          created_at?: string | null
          description?: string | null
          estimated_price?: number | null
          group_id?: string | null
          icon_name?: string | null
          id?: string
          image_url?: string | null
          is_checked?: boolean | null
          is_custom?: boolean | null
          is_night_one?: boolean
          item: string
          link?: string | null
          link_image?: string | null
          link_title?: string | null
          needs_purchase?: boolean | null
          note?: string | null
          order_index?: number | null
          position?: number | null
          split_cost?: boolean | null
          split_participant_ids?: string[] | null
          split_percentages?: Json | null
          status?: string | null
          user_id: string
          variant_label?: string | null
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string | null
          description?: string | null
          estimated_price?: number | null
          group_id?: string | null
          icon_name?: string | null
          id?: string
          image_url?: string | null
          is_checked?: boolean | null
          is_custom?: boolean | null
          is_night_one?: boolean
          item?: string
          link?: string | null
          link_image?: string | null
          link_title?: string | null
          needs_purchase?: boolean | null
          note?: string | null
          order_index?: number | null
          position?: number | null
          split_cost?: boolean | null
          split_participant_ids?: string[] | null
          split_percentages?: Json | null
          status?: string | null
          user_id?: string
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ranking_collaborations"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_payment_acks: {
        Row: {
          created_at: string
          creditor_id: string
          debtor_id: string
          group_id: string
          sent_at: string
        }
        Insert: {
          created_at?: string
          creditor_id: string
          debtor_id: string
          group_id: string
          sent_at?: string
        }
        Update: {
          created_at?: string
          creditor_id?: string
          debtor_id?: string
          group_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_payment_acks_creditor_id_fkey"
            columns: ["creditor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_payment_acks_debtor_id_fkey"
            columns: ["debtor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_payment_acks_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ranking_collaborations"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_payments: {
        Row: {
          amount: number
          created_at: string
          group_id: string
          id: string
          paid_at: string
          payee_id: string
          payer_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          group_id: string
          id?: string
          paid_at?: string
          payee_id: string
          payer_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          group_id?: string
          id?: string
          paid_at?: string
          payee_id?: string
          payer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_payments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ranking_collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_payments_payee_id_fkey"
            columns: ["payee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_payments_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_share_links: {
        Row: {
          can_check: boolean
          created_at: string
          created_by: string
          expires_at: string | null
          group_id: string
          id: string
          label: string | null
          revoked: boolean
          token: string
        }
        Insert: {
          can_check?: boolean
          created_at?: string
          created_by: string
          expires_at?: string | null
          group_id: string
          id?: string
          label?: string | null
          revoked?: boolean
          token?: string
        }
        Update: {
          can_check?: boolean
          created_at?: string
          created_by?: string
          expires_at?: string | null
          group_id?: string
          id?: string
          label?: string | null
          revoked?: boolean
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_share_links_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ranking_collaborations"
            referencedColumns: ["id"]
          },
        ]
      }
      community_room_optouts: {
        Row: {
          group_id: string
          left_at: string
          user_id: string
        }
        Insert: {
          group_id: string
          left_at?: string
          user_id: string
        }
        Update: {
          group_id?: string
          left_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_room_optouts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_room_optouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_reports: {
        Row: {
          category: string | null
          content_id: string
          content_type: string
          created_at: string
          escalated_at: string | null
          escalated_by: string | null
          id: string
          reason: string | null
          reporter_id: string
        }
        Insert: {
          category?: string | null
          content_id: string
          content_type: string
          created_at?: string
          escalated_at?: string | null
          escalated_by?: string | null
          id?: string
          reason?: string | null
          reporter_id: string
        }
        Update: {
          category?: string | null
          content_id?: string
          content_type?: string
          created_at?: string
          escalated_at?: string | null
          escalated_by?: string | null
          id?: string
          reason?: string | null
          reporter_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          id: string
          initiated_by: string | null
          last_message: string | null
          participant_1: string
          participant_1_last_notified_at: string | null
          participant_1_last_read: string | null
          participant_2: string
          participant_2_last_notified_at: string | null
          participant_2_last_read: string | null
          status: string
          updated_at: string | null
          user_a_last_read_at: string | null
          user_b_last_read_at: string | null
        }
        Insert: {
          id?: string
          initiated_by?: string | null
          last_message?: string | null
          participant_1: string
          participant_1_last_notified_at?: string | null
          participant_1_last_read?: string | null
          participant_2: string
          participant_2_last_notified_at?: string | null
          participant_2_last_read?: string | null
          status?: string
          updated_at?: string | null
          user_a_last_read_at?: string | null
          user_b_last_read_at?: string | null
        }
        Update: {
          id?: string
          initiated_by?: string | null
          last_message?: string | null
          participant_1?: string
          participant_1_last_notified_at?: string | null
          participant_1_last_read?: string | null
          participant_2?: string
          participant_2_last_notified_at?: string | null
          participant_2_last_read?: string | null
          status?: string
          updated_at?: string | null
          user_a_last_read_at?: string | null
          user_b_last_read_at?: string | null
        }
        Relationships: []
      }
      course_sections: {
        Row: {
          building_abbr: string | null
          catalog_number: string
          class_number: string
          component: string | null
          created_at: string
          days: string[]
          end_time: string | null
          id: string
          lat: number | null
          lng: number | null
          location_status: string
          room: string | null
          section: string
          start_time: string | null
          subject: string
          term: string
          title: string | null
          title_display: string | null
          university_id: string | null
        }
        Insert: {
          building_abbr?: string | null
          catalog_number: string
          class_number: string
          component?: string | null
          created_at?: string
          days?: string[]
          end_time?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          location_status?: string
          room?: string | null
          section: string
          start_time?: string | null
          subject: string
          term: string
          title?: string | null
          title_display?: string | null
          university_id?: string | null
        }
        Update: {
          building_abbr?: string | null
          catalog_number?: string
          class_number?: string
          component?: string | null
          created_at?: string
          days?: string[]
          end_time?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          location_status?: string
          room?: string | null
          section?: string
          start_time?: string | null
          subject?: string
          term?: string
          title?: string | null
          title_display?: string | null
          university_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_sections_building_abbr_fkey"
            columns: ["building_abbr"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["abbr"]
          },
          {
            foreignKeyName: "course_sections_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_accounts: {
        Row: {
          auth_user_id: string
          deleted_at: string
          email: string | null
          id: string
          metadata: Json
        }
        Insert: {
          auth_user_id: string
          deleted_at?: string
          email?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          auth_user_id?: string
          deleted_at?: string
          email?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          device_name: string | null
          id: string
          last_used_at: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_name?: string | null
          id?: string
          last_used_at?: string
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_name?: string | null
          id?: string
          last_used_at?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dorm_answers: {
        Row: {
          answer: string
          created_at: string
          id: string
          question_id: string
          user_id: string | null
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          question_id: string
          user_id?: string | null
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          question_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dorm_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "dorm_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dorm_answers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dorm_edits: {
        Row: {
          created_at: string
          dorm_id: number
          edited_by: string | null
          field_name: string
          id: string
          new_value: Json | null
          old_value: Json | null
        }
        Insert: {
          created_at?: string
          dorm_id: number
          edited_by?: string | null
          field_name: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Update: {
          created_at?: string
          dorm_id?: number
          edited_by?: string | null
          field_name?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "dorm_edits_dorm_id_fkey"
            columns: ["dorm_id"]
            isOneToOne: false
            referencedRelation: "master_housing"
            referencedColumns: ["id"]
          },
        ]
      }
      dorm_future_residents: {
        Row: {
          created_at: string
          dorm_id: number
          id: string
          user_id: string
          year: string
        }
        Insert: {
          created_at?: string
          dorm_id: number
          id?: string
          user_id: string
          year: string
        }
        Update: {
          created_at?: string
          dorm_id?: number
          id?: string
          user_id?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "dorm_future_residents_dorm_id_fkey"
            columns: ["dorm_id"]
            isOneToOne: false
            referencedRelation: "master_housing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dorm_future_residents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dorm_question_upvotes: {
        Row: {
          created_at: string
          id: string
          question_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          question_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          question_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dorm_question_upvotes_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "dorm_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dorm_question_upvotes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dorm_questions: {
        Row: {
          created_at: string
          dorm_id: number
          id: string
          question: string
          university_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          dorm_id: number
          id?: string
          question: string
          university_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          dorm_id?: number
          id?: string
          question?: string
          university_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dorm_questions_dorm_id_fkey"
            columns: ["dorm_id"]
            isOneToOne: false
            referencedRelation: "master_housing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dorm_questions_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dorm_questions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          reason?: string
        }
        Relationships: []
      }
      explore_picks: {
        Row: {
          created_at: string
          product_name: string
          university_id: string | null
          user_id: string
          variant_affiliate_link: string | null
          variant_asin: string | null
          variant_id: string | null
          variant_image_url: string | null
          variant_label: string | null
        }
        Insert: {
          created_at?: string
          product_name: string
          university_id?: string | null
          user_id: string
          variant_affiliate_link?: string | null
          variant_asin?: string | null
          variant_id?: string | null
          variant_image_url?: string | null
          variant_label?: string | null
        }
        Update: {
          created_at?: string
          product_name?: string
          university_id?: string | null
          user_id?: string
          variant_affiliate_link?: string | null
          variant_asin?: string | null
          variant_id?: string | null
          variant_image_url?: string | null
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "explore_picks_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      favorite_roommates: {
        Row: {
          created_at: string | null
          id: string
          prospect_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          prospect_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          prospect_id?: string
          user_id?: string
        }
        Relationships: []
      }
      group_conversations: {
        Row: {
          building_id: number | null
          created_at: string
          created_by: string | null
          floor: string | null
          id: string
          last_message: string | null
          name: string
          pinned_at: string | null
          pinned_by: string | null
          pinned_message_id: string | null
          updated_at: string
        }
        Insert: {
          building_id?: number | null
          created_at?: string
          created_by?: string | null
          floor?: string | null
          id?: string
          last_message?: string | null
          name: string
          pinned_at?: string | null
          pinned_by?: string | null
          pinned_message_id?: string | null
          updated_at?: string
        }
        Update: {
          building_id?: number | null
          created_at?: string
          created_by?: string | null
          floor?: string | null
          id?: string
          last_message?: string | null
          name?: string
          pinned_at?: string | null
          pinned_by?: string | null
          pinned_message_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_conversations_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "master_housing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_conversations_pinned_message_id_fkey"
            columns: ["pinned_message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      group_dorm_rankings: {
        Row: {
          created_at: string | null
          dorm_id: number
          group_id: string | null
          id: string
          rank_order: number
        }
        Insert: {
          created_at?: string | null
          dorm_id: number
          group_id?: string | null
          id?: string
          rank_order: number
        }
        Update: {
          created_at?: string | null
          dorm_id?: number
          group_id?: string | null
          id?: string
          rank_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_dorm_rankings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ranking_collaborations"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string
          joined_at: string
          last_read_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          group_id: string
          joined_at?: string
          last_read_at?: string | null
          role?: string
          user_id: string
        }
        Update: {
          group_id?: string
          joined_at?: string
          last_read_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      group_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          group_id: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          group_id: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          group_id?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_message_reactions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      group_messages: {
        Row: {
          content: string
          created_at: string
          group_id: string
          id: string
          metadata: Json | null
          sender_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          group_id: string
          id?: string
          metadata?: Json | null
          sender_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          group_id?: string
          id?: string
          metadata?: Json | null
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_verifications: {
        Row: {
          address_confirmation: string | null
          created_at: string
          evidence_path: string | null
          id: string
          listing_id: string
          method: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          address_confirmation?: string | null
          created_at?: string
          evidence_path?: string | null
          id?: string
          listing_id: string
          method: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          address_confirmation?: string | null
          created_at?: string
          evidence_path?: string | null
          id?: string
          listing_id?: string
          method?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_verifications_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_alerts: {
        Row: {
          categories: string[]
          created_at: string
          enabled: boolean
          id: string
          keywords: string | null
          max_price: number | null
          min_price: number | null
          name: string
          university_id: string | null
          user_id: string
        }
        Insert: {
          categories?: string[]
          created_at?: string
          enabled?: boolean
          id?: string
          keywords?: string | null
          max_price?: number | null
          min_price?: number | null
          name: string
          university_id?: string | null
          user_id: string
        }
        Update: {
          categories?: string[]
          created_at?: string
          enabled?: boolean
          id?: string
          keywords?: string | null
          max_price?: number | null
          min_price?: number | null
          name?: string
          university_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_alerts_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_listing_items: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          name: string
          photo_index: number
          price: number
          status: string
          x: number | null
          y: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          name: string
          photo_index?: number
          price: number
          status?: string
          x?: number | null
          y?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          name?: string
          photo_index?: number
          price?: number
          status?: string
          x?: number | null
          y?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listing_items_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_listings: {
        Row: {
          additional_rules: string | null
          building_id: string | null
          building_name: string | null
          category: string
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          condition: string | null
          created_at: string
          description: string | null
          freshness_nudged_at: string | null
          gender_preference: string | null
          has_parking: boolean | null
          house_rules: string | null
          id: string
          image_url: string | null
          image_urls: string[] | null
          included_utilities: string[] | null
          instagram_handle: string | null
          is_furnished: boolean | null
          is_sublease: boolean | null
          last_confirmed_at: string
          latitude: number | null
          longitude: number | null
          meetup_location: string | null
          moderated_at: string | null
          moderation_categories: string[] | null
          moderation_decision: string | null
          moderation_reason: string | null
          moderation_started_at: string | null
          original_price: number | null
          parking: boolean | null
          payment_methods: string[]
          phone_number: string | null
          post_type: string
          service_category: string | null
          service_date: string | null
          service_duration_minutes: number | null
          service_location: string | null
          service_notes: string | null
          price: number
          price_negotiable: boolean | null
          show_instagram: boolean | null
          show_phone: boolean
          show_snapchat: boolean | null
          snapchat_handle: string | null
          status: string
          sublease_end: string | null
          sublease_start: string | null
          title: string
          under_review_notified_at: string | null
          university_id: string | null
          user_id: string
          utilities: string[] | null
          verified_at: string | null
        }
        Insert: {
          additional_rules?: string | null
          building_id?: string | null
          building_name?: string | null
          category: string
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          condition?: string | null
          created_at?: string
          description?: string | null
          freshness_nudged_at?: string | null
          gender_preference?: string | null
          has_parking?: boolean | null
          house_rules?: string | null
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          included_utilities?: string[] | null
          instagram_handle?: string | null
          is_furnished?: boolean | null
          is_sublease?: boolean | null
          last_confirmed_at?: string
          latitude?: number | null
          longitude?: number | null
          meetup_location?: string | null
          moderated_at?: string | null
          moderation_categories?: string[] | null
          moderation_decision?: string | null
          moderation_reason?: string | null
          moderation_started_at?: string | null
          original_price?: number | null
          parking?: boolean | null
          payment_methods?: string[]
          phone_number?: string | null
          post_type?: string
          service_category?: string | null
          service_date?: string | null
          service_duration_minutes?: number | null
          service_location?: string | null
          service_notes?: string | null
          price: number
          price_negotiable?: boolean | null
          show_instagram?: boolean | null
          show_phone?: boolean
          show_snapchat?: boolean | null
          snapchat_handle?: string | null
          status?: string
          sublease_end?: string | null
          sublease_start?: string | null
          title: string
          under_review_notified_at?: string | null
          university_id?: string | null
          user_id: string
          utilities?: string[] | null
          verified_at?: string | null
        }
        Update: {
          additional_rules?: string | null
          building_id?: string | null
          building_name?: string | null
          category?: string
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          condition?: string | null
          created_at?: string
          description?: string | null
          freshness_nudged_at?: string | null
          gender_preference?: string | null
          has_parking?: boolean | null
          house_rules?: string | null
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          included_utilities?: string[] | null
          instagram_handle?: string | null
          is_furnished?: boolean | null
          is_sublease?: boolean | null
          last_confirmed_at?: string
          latitude?: number | null
          longitude?: number | null
          meetup_location?: string | null
          moderated_at?: string | null
          moderation_categories?: string[] | null
          moderation_decision?: string | null
          moderation_reason?: string | null
          moderation_started_at?: string | null
          original_price?: number | null
          parking?: boolean | null
          payment_methods?: string[]
          phone_number?: string | null
          post_type?: string
          service_category?: string | null
          service_date?: string | null
          service_duration_minutes?: number | null
          service_location?: string | null
          service_notes?: string | null
          price?: number
          price_negotiable?: boolean | null
          show_instagram?: boolean | null
          show_phone?: boolean
          show_snapchat?: boolean | null
          snapchat_handle?: string | null
          status?: string
          sublease_end?: string | null
          sublease_start?: string | null
          title?: string
          under_review_notified_at?: string | null
          university_id?: string | null
          user_id?: string
          utilities?: string[] | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_listings_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_listings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_listings_user_id_profiles_public_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_listings_user_id_profiles_public_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      master_housing: {
        Row: {
          accomodation: string | null
          address: string | null
          building_amenities: string | null
          building_llc: string | null
          capacity: string | null
          community_type: string | null
          details: string | null
          floorplan: string | null
          floors: number | null
          heat_and_air_conditioning: boolean | null
          housing_type: string | null
          id: number
          image_url: string | null
          important_dates: string | null
          inroom_amenities: string | null
          latitude: number | null
          laundry: string | null
          longitude: number | null
          mailing_address: string | null
          mailing_services: string | null
          meal_plan_options: boolean | null
          move_in_cart_location: string | null
          move_in_date: string | null
          move_in_entrance: string | null
          move_in_notes: string | null
          move_in_parking_lot: string | null
          move_in_time_window: string | null
          rate_per_term: string | null
          rent_period: string | null
          residence_hall: string | null
          resident_director: string | null
          terms: string | null
          university_id: string | null
          who_lives_here: string | null
          wifi_and_cable: boolean | null
          window_coverings: boolean | null
        }
        Insert: {
          accomodation?: string | null
          address?: string | null
          building_amenities?: string | null
          building_llc?: string | null
          capacity?: string | null
          community_type?: string | null
          details?: string | null
          floorplan?: string | null
          floors?: number | null
          heat_and_air_conditioning?: boolean | null
          housing_type?: string | null
          id: number
          image_url?: string | null
          important_dates?: string | null
          inroom_amenities?: string | null
          latitude?: number | null
          laundry?: string | null
          longitude?: number | null
          mailing_address?: string | null
          mailing_services?: string | null
          meal_plan_options?: boolean | null
          move_in_cart_location?: string | null
          move_in_date?: string | null
          move_in_entrance?: string | null
          move_in_notes?: string | null
          move_in_parking_lot?: string | null
          move_in_time_window?: string | null
          rate_per_term?: string | null
          rent_period?: string | null
          residence_hall?: string | null
          resident_director?: string | null
          terms?: string | null
          university_id?: string | null
          who_lives_here?: string | null
          wifi_and_cable?: boolean | null
          window_coverings?: boolean | null
        }
        Update: {
          accomodation?: string | null
          address?: string | null
          building_amenities?: string | null
          building_llc?: string | null
          capacity?: string | null
          community_type?: string | null
          details?: string | null
          floorplan?: string | null
          floors?: number | null
          heat_and_air_conditioning?: boolean | null
          housing_type?: string | null
          id?: number
          image_url?: string | null
          important_dates?: string | null
          inroom_amenities?: string | null
          latitude?: number | null
          laundry?: string | null
          longitude?: number | null
          mailing_address?: string | null
          mailing_services?: string | null
          meal_plan_options?: boolean | null
          move_in_cart_location?: string | null
          move_in_date?: string | null
          move_in_entrance?: string | null
          move_in_notes?: string | null
          move_in_parking_lot?: string | null
          move_in_time_window?: string | null
          rate_per_term?: string | null
          rent_period?: string | null
          residence_hall?: string | null
          resident_director?: string | null
          terms?: string | null
          university_id?: string | null
          who_lives_here?: string | null
          wifi_and_cable?: boolean | null
          window_coverings?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "master_housing_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          conversation_id: string
          created_at: string
          emoji: string
          id: string
          message_id: number
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          emoji: string
          id?: string
          message_id: number
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          emoji?: string
          id?: string
          message_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          id: number
          is_read: boolean | null
          sender_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          id?: number
          is_read?: boolean | null
          sender_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          id?: number
          is_read?: boolean | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_backup_codes: {
        Row: {
          code_hash: string
          created_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      moderation_actions: {
        Row: {
          action: string
          admin_id: string | null
          content_id: string
          content_type: string
          created_at: string
          id: string
          reason: string | null
          report_id: string | null
          reporter_id: string | null
        }
        Insert: {
          action: string
          admin_id?: string | null
          content_id: string
          content_type: string
          created_at?: string
          id?: string
          reason?: string | null
          report_id?: string | null
          reporter_id?: string | null
        }
        Update: {
          action?: string
          admin_id?: string | null
          content_id?: string
          content_type?: string
          created_at?: string
          id?: string
          reason?: string | null
          report_id?: string | null
          reporter_id?: string | null
        }
        Relationships: []
      }
      movein_push_log: {
        Row: {
          milestone: number
          sent_at: string
          user_id: string
        }
        Insert: {
          milestone: number
          sent_at?: string
          user_id: string
        }
        Update: {
          milestone?: number
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          payload: Json
          read_at: string | null
          recipient_id: string
          type: string
          university_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          recipient_id: string
          type: string
          university_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          recipient_id?: string
          type?: string
          university_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_history: {
        Row: {
          amount: number
          created_at: string
          group_id: string
          id: string
          method: string | null
          note: string | null
          payer_id: string
          receiver_id: string
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          group_id: string
          id?: string
          method?: string | null
          note?: string | null
          payer_id: string
          receiver_id: string
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          group_id?: string
          id?: string
          method?: string | null
          note?: string | null
          payer_id?: string
          receiver_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_history_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ranking_collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_history_payer_id_fkey"
            columns: ["payer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_history_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pogoh_station: {
        Row: {
          Id: number
          Latitude: number | null
          Longitude: number | null
          Name: string | null
          "Total Docks": number | null
        }
        Insert: {
          Id: number
          Latitude?: number | null
          Longitude?: number | null
          Name?: string | null
          "Total Docks"?: number | null
        }
        Update: {
          Id?: number
          Latitude?: number | null
          Longitude?: number | null
          Name?: string | null
          "Total Docks"?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          admin_scopes: string[] | null
          app_bookmarks: Json | null
          avatar_url: string | null
          bio: string | null
          checklist_completed_at: string | null
          checklist_started_at: string | null
          cleanliness: string | null
          conflict_style: string | null
          created_at: string
          current_dorm: string | null
          current_floor: string | null
          current_room: string | null
          dealbreakers: string[] | null
          discoverable: boolean
          email: string | null
          email_notifications: boolean
          full_name: string | null
          grade_level: string | null
          graduation_semester: string | null
          graduation_year: number | null
          guest_preference: string | null
          guests: string | null
          has_completed_onboarding: boolean | null
          home_layout: Json | null
          housing_type: string | null
          id: string
          instagram_username: string | null
          interests: string[] | null
          is_admin: boolean | null
          is_public: boolean | null
          is_roommate_searching: boolean | null
          login_alerts: boolean
          major: string | null
          message_privacy: string
          mfa_reenroll_required: boolean
          move_in_date: string | null
          neighborhood: string | null
          notification_prefs: Json
          phone_number: string | null
          preferred_areas: string[] | null
          profile_photos: string[] | null
          prompts: Json | null
          pronouns: string | null
          quiet_hours_enabled: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          quiet_hours_timezone: string | null
          role: Database["public"]["Enums"]["app_role"]
          school: string | null
          show_in_building: boolean
          sleep: string | null
          sleep_habit: string | null
          smoking: string | null
          snapchat_username: string | null
          social_level: string | null
          study_style: string | null
          tags: string[] | null
          temp: string | null
          temp_preference: string | null
          theme_preference: string | null
          university_id: string | null
          venmo_username: string | null
          zelle_info: string | null
        }
        Insert: {
          admin_scopes?: string[] | null
          app_bookmarks?: Json | null
          avatar_url?: string | null
          bio?: string | null
          checklist_completed_at?: string | null
          checklist_started_at?: string | null
          cleanliness?: string | null
          conflict_style?: string | null
          created_at?: string
          current_dorm?: string | null
          current_floor?: string | null
          current_room?: string | null
          dealbreakers?: string[] | null
          discoverable?: boolean
          email?: string | null
          email_notifications?: boolean
          full_name?: string | null
          grade_level?: string | null
          graduation_semester?: string | null
          graduation_year?: number | null
          guest_preference?: string | null
          guests?: string | null
          has_completed_onboarding?: boolean | null
          home_layout?: Json | null
          housing_type?: string | null
          id: string
          instagram_username?: string | null
          interests?: string[] | null
          is_admin?: boolean | null
          is_public?: boolean | null
          is_roommate_searching?: boolean | null
          login_alerts?: boolean
          major?: string | null
          message_privacy?: string
          mfa_reenroll_required?: boolean
          move_in_date?: string | null
          neighborhood?: string | null
          notification_prefs?: Json
          phone_number?: string | null
          preferred_areas?: string[] | null
          profile_photos?: string[] | null
          prompts?: Json | null
          pronouns?: string | null
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          quiet_hours_timezone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          school?: string | null
          show_in_building?: boolean
          sleep?: string | null
          sleep_habit?: string | null
          smoking?: string | null
          snapchat_username?: string | null
          social_level?: string | null
          study_style?: string | null
          tags?: string[] | null
          temp?: string | null
          temp_preference?: string | null
          theme_preference?: string | null
          university_id?: string | null
          venmo_username?: string | null
          zelle_info?: string | null
        }
        Update: {
          admin_scopes?: string[] | null
          app_bookmarks?: Json | null
          avatar_url?: string | null
          bio?: string | null
          checklist_completed_at?: string | null
          checklist_started_at?: string | null
          cleanliness?: string | null
          conflict_style?: string | null
          created_at?: string
          current_dorm?: string | null
          current_floor?: string | null
          current_room?: string | null
          dealbreakers?: string[] | null
          discoverable?: boolean
          email?: string | null
          email_notifications?: boolean
          full_name?: string | null
          grade_level?: string | null
          graduation_semester?: string | null
          graduation_year?: number | null
          guest_preference?: string | null
          guests?: string | null
          has_completed_onboarding?: boolean | null
          home_layout?: Json | null
          housing_type?: string | null
          id?: string
          instagram_username?: string | null
          interests?: string[] | null
          is_admin?: boolean | null
          is_public?: boolean | null
          is_roommate_searching?: boolean | null
          login_alerts?: boolean
          major?: string | null
          message_privacy?: string
          mfa_reenroll_required?: boolean
          move_in_date?: string | null
          neighborhood?: string | null
          notification_prefs?: Json
          phone_number?: string | null
          preferred_areas?: string[] | null
          profile_photos?: string[] | null
          prompts?: Json | null
          pronouns?: string | null
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          quiet_hours_timezone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          school?: string | null
          show_in_building?: boolean
          sleep?: string | null
          sleep_habit?: string | null
          smoking?: string | null
          snapchat_username?: string | null
          social_level?: string | null
          study_style?: string | null
          tags?: string[] | null
          temp?: string | null
          temp_preference?: string | null
          theme_preference?: string | null
          university_id?: string | null
          venmo_username?: string | null
          zelle_info?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles_public: {
        Row: {
          avatar_url: string | null
          full_name: string | null
          id: string
          university_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          full_name?: string | null
          id: string
          university_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          full_name?: string | null
          id?: string
          university_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_public_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles_roommate: {
        Row: {
          avatar_url: string | null
          bio: string | null
          cleanliness: string | null
          conflict_style: string | null
          created_at: string | null
          current_dorm: string | null
          dealbreakers: string[] | null
          full_name: string | null
          grade_level: string | null
          graduation_semester: string | null
          graduation_year: number | null
          guest_preference: string | null
          guests: string | null
          housing_type: string | null
          id: string
          instagram_username: string | null
          interests: string[] | null
          is_public: boolean | null
          is_roommate_searching: boolean | null
          major: string | null
          neighborhood: string | null
          preferred_areas: string[] | null
          profile_photos: string[] | null
          prompts: Json | null
          pronouns: string | null
          school: string | null
          sleep: string | null
          sleep_habit: string | null
          smoking: string | null
          snapchat_username: string | null
          social_level: string | null
          study_style: string | null
          tags: string[] | null
          temp: string | null
          temp_preference: string | null
          university_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          cleanliness?: string | null
          conflict_style?: string | null
          created_at?: string | null
          current_dorm?: string | null
          dealbreakers?: string[] | null
          full_name?: string | null
          grade_level?: string | null
          graduation_semester?: string | null
          graduation_year?: number | null
          guest_preference?: string | null
          guests?: string | null
          housing_type?: string | null
          id: string
          instagram_username?: string | null
          interests?: string[] | null
          is_public?: boolean | null
          is_roommate_searching?: boolean | null
          major?: string | null
          neighborhood?: string | null
          preferred_areas?: string[] | null
          profile_photos?: string[] | null
          prompts?: Json | null
          pronouns?: string | null
          school?: string | null
          sleep?: string | null
          sleep_habit?: string | null
          smoking?: string | null
          snapchat_username?: string | null
          social_level?: string | null
          study_style?: string | null
          tags?: string[] | null
          temp?: string | null
          temp_preference?: string | null
          university_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          cleanliness?: string | null
          conflict_style?: string | null
          created_at?: string | null
          current_dorm?: string | null
          dealbreakers?: string[] | null
          full_name?: string | null
          grade_level?: string | null
          graduation_semester?: string | null
          graduation_year?: number | null
          guest_preference?: string | null
          guests?: string | null
          housing_type?: string | null
          id?: string
          instagram_username?: string | null
          interests?: string[] | null
          is_public?: boolean | null
          is_roommate_searching?: boolean | null
          major?: string | null
          neighborhood?: string | null
          preferred_areas?: string[] | null
          profile_photos?: string[] | null
          prompts?: Json | null
          pronouns?: string | null
          school?: string | null
          sleep?: string | null
          sleep_habit?: string | null
          smoking?: string | null
          snapchat_username?: string | null
          social_level?: string | null
          study_style?: string | null
          tags?: string[] | null
          temp?: string | null
          temp_preference?: string | null
          university_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_roommate_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_broadcasts: {
        Row: {
          audience_detail: Json
          audience_type: string
          body: string
          created_at: string
          failed_count: number
          id: string
          route: string | null
          scheduled_for: string | null
          sender_id: string | null
          sent_count: number
          status: string
          title: string
        }
        Insert: {
          audience_detail?: Json
          audience_type: string
          body: string
          created_at?: string
          failed_count?: number
          id?: string
          route?: string | null
          scheduled_for?: string | null
          sender_id?: string | null
          sent_count?: number
          status?: string
          title: string
        }
        Update: {
          audience_detail?: Json
          audience_type?: string
          body?: string
          created_at?: string
          failed_count?: number
          id?: string
          route?: string | null
          scheduled_for?: string | null
          sender_id?: string | null
          sent_count?: number
          status?: string
          title?: string
        }
        Relationships: []
      }
      ranking_collaborations: {
        Row: {
          collaborator_id: string | null
          created_at: string | null
          dorm_name: string | null
          group_name: string | null
          group_type: string
          id: string
          invite_code: string
          owner_id: string
          parent_group_id: string | null
          status: string | null
          term: string | null
          unit_label: string | null
          university_id: string | null
        }
        Insert: {
          collaborator_id?: string | null
          created_at?: string | null
          dorm_name?: string | null
          group_name?: string | null
          group_type?: string
          id?: string
          invite_code?: string
          owner_id: string
          parent_group_id?: string | null
          status?: string | null
          term?: string | null
          unit_label?: string | null
          university_id?: string | null
        }
        Update: {
          collaborator_id?: string | null
          created_at?: string | null
          dorm_name?: string | null
          group_name?: string | null
          group_type?: string
          id?: string
          invite_code?: string
          owner_id?: string
          parent_group_id?: string | null
          status?: string | null
          term?: string | null
          unit_label?: string | null
          university_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_collaborator"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_collaborator_profile"
            columns: ["collaborator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ranking_collaborations_parent_group_id_fkey"
            columns: ["parent_group_id"]
            isOneToOne: false
            referencedRelation: "ranking_collaborations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ranking_collaborations_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      ranking_group_members: {
        Row: {
          added_at: string | null
          created_at: string
          group_id: string | null
          id: string
          role: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          added_at?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          role?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          added_at?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          role?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ranking_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ranking_collaborations"
            referencedColumns: ["id"]
          },
        ]
      }
      roommate_search_interests: {
        Row: {
          created_at: string
          id: string
          message: string | null
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roommate_search_interests_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "roommate_search_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_search_interests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_roommate"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_search_interests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "roommate_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_search_interests_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roommate_search_posts: {
        Row: {
          additional_details: string | null
          address: string | null
          bathroom: string | null
          budget_max: number | null
          content: string
          created_at: string
          gender_preference: string | null
          housing_type: string | null
          id: string
          instagram: string | null
          interest_count: number
          is_active: boolean
          is_furnished: boolean | null
          laundry: string | null
          lease_length: string | null
          move_in_semester: string | null
          parking_available: boolean | null
          pets_allowed: boolean | null
          phone_number: string | null
          photos: string[]
          post_type: string
          preferred_areas: string[] | null
          room_type: string | null
          show_instagram: boolean
          show_phone: boolean
          show_snapchat: boolean
          smoking_allowed: boolean | null
          snapchat: string | null
          spots_filled: number
          spots_total: number
          university_id: string | null
          updated_at: string
          user_id: string
          utilities_included: string[]
        }
        Insert: {
          additional_details?: string | null
          address?: string | null
          bathroom?: string | null
          budget_max?: number | null
          content: string
          created_at?: string
          gender_preference?: string | null
          housing_type?: string | null
          id?: string
          instagram?: string | null
          interest_count?: number
          is_active?: boolean
          is_furnished?: boolean | null
          laundry?: string | null
          lease_length?: string | null
          move_in_semester?: string | null
          parking_available?: boolean | null
          pets_allowed?: boolean | null
          phone_number?: string | null
          photos?: string[]
          post_type: string
          preferred_areas?: string[] | null
          room_type?: string | null
          show_instagram?: boolean
          show_phone?: boolean
          show_snapchat?: boolean
          smoking_allowed?: boolean | null
          snapchat?: string | null
          spots_filled?: number
          spots_total?: number
          university_id?: string | null
          updated_at?: string
          user_id: string
          utilities_included?: string[]
        }
        Update: {
          additional_details?: string | null
          address?: string | null
          bathroom?: string | null
          budget_max?: number | null
          content?: string
          created_at?: string
          gender_preference?: string | null
          housing_type?: string | null
          id?: string
          instagram?: string | null
          interest_count?: number
          is_active?: boolean
          is_furnished?: boolean | null
          laundry?: string | null
          lease_length?: string | null
          move_in_semester?: string | null
          parking_available?: boolean | null
          pets_allowed?: boolean | null
          phone_number?: string | null
          photos?: string[]
          post_type?: string
          preferred_areas?: string[] | null
          room_type?: string | null
          show_instagram?: boolean
          show_phone?: boolean
          show_snapchat?: boolean
          smoking_allowed?: boolean | null
          snapchat?: string | null
          spots_filled?: number
          spots_total?: number
          university_id?: string | null
          updated_at?: string
          user_id?: string
          utilities_included?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "roommate_search_posts_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_search_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles_roommate"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_search_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "roommate_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roommate_search_posts_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_businesses: {
        Row: {
          business_listing_id: string
          created_at: string | null
          user_id: string
        }
        Insert: {
          business_listing_id: string
          created_at?: string | null
          user_id: string
        }
        Update: {
          business_listing_id?: string
          created_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_businesses_business_listing_id_fkey"
            columns: ["business_listing_id"]
            isOneToOne: false
            referencedRelation: "business_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_dorms: {
        Row: {
          created_at: string | null
          dorm_id: number
          id: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          dorm_id: number
          id?: number
          user_id: string
        }
        Update: {
          created_at?: string | null
          dorm_id?: number
          id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_dorms_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_items: {
        Row: {
          created_at: string
          item_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          item_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          item_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_subleases: {
        Row: {
          created_at: string
          sublease_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          sublease_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          sublease_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_subleases_sublease_id_fkey"
            columns: ["sublease_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      school_directory: {
        Row: {
          created_at: string
          email_domain: string
          university_name: string
        }
        Insert: {
          created_at?: string
          email_domain: string
          university_name: string
        }
        Update: {
          created_at?: string
          email_domain?: string
          university_name?: string
        }
        Relationships: []
      }
      school_domains: {
        Row: {
          created_at: string
          domain: string
          school_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          school_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_domains_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          city: string | null
          created_at: string
          enrollment: number | null
          id: string
          ipeds_unitid: number
          matched_university_id: string | null
          name: string
          ownership: string | null
          state: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          enrollment?: number | null
          id?: string
          ipeds_unitid: number
          matched_university_id?: string | null
          name: string
          ownership?: string | null
          state?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          enrollment?: number | null
          id?: string
          ipeds_unitid?: number
          matched_university_id?: string | null
          name?: string
          ownership?: string | null
          state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schools_matched_university_id_fkey"
            columns: ["matched_university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          listing_id: string | null
          rater_id: string
          seller_id: string
          stars: number
          updated_at: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          rater_id: string
          seller_id: string
          stars: number
          updated_at?: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          rater_id?: string
          seller_id?: string
          stars?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_ratings_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_ratings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      setup_comment_likes: {
        Row: {
          comment_id: number
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          comment_id: number
          created_at?: string
          id?: never
          user_id: string
        }
        Update: {
          comment_id?: number
          created_at?: string
          id?: never
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "setup_comment_likes_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "setup_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      setup_comments: {
        Row: {
          author_name: string
          content: string
          created_at: string | null
          id: number
          parent_id: number | null
          setup_id: number
          user_id: string | null
        }
        Insert: {
          author_name: string
          content: string
          created_at?: string | null
          id?: number
          parent_id?: number | null
          setup_id: number
          user_id?: string | null
        }
        Update: {
          author_name?: string
          content?: string
          created_at?: string | null
          id?: number
          parent_id?: number | null
          setup_id?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "setup_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "setup_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "setup_comments_setup_id_fkey"
            columns: ["setup_id"]
            isOneToOne: false
            referencedRelation: "student_setups"
            referencedColumns: ["id"]
          },
        ]
      }
      setup_likes: {
        Row: {
          created_at: string
          id: string
          setup_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          setup_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          setup_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "setup_likes_setup_id_fkey"
            columns: ["setup_id"]
            isOneToOne: false
            referencedRelation: "student_setups"
            referencedColumns: ["id"]
          },
        ]
      }
      setup_photos: {
        Row: {
          created_at: string | null
          id: number
          image_url: string
          setup_id: number
        }
        Insert: {
          created_at?: string | null
          id?: number
          image_url: string
          setup_id: number
        }
        Update: {
          created_at?: string | null
          id?: number
          image_url?: string
          setup_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "setup_photos_setup_id_fkey"
            columns: ["setup_id"]
            isOneToOne: false
            referencedRelation: "student_setups"
            referencedColumns: ["id"]
          },
        ]
      }
      setup_products: {
        Row: {
          created_at: string | null
          id: number
          listing_id: string | null
          product_name: string
          product_url: string
          setup_id: number
        }
        Insert: {
          created_at?: string | null
          id?: number
          listing_id?: string | null
          product_name: string
          product_url: string
          setup_id: number
        }
        Update: {
          created_at?: string | null
          id?: number
          listing_id?: string | null
          product_name?: string
          product_url?: string
          setup_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "setup_products_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "setup_products_setup_id_fkey"
            columns: ["setup_id"]
            isOneToOne: false
            referencedRelation: "student_setups"
            referencedColumns: ["id"]
          },
        ]
      }
      student_reviews: {
        Row: {
          building_id: number
          comment: string | null
          created_at: string
          id: string
          is_anonymous: boolean
          rating: number
          rating_community: number | null
          rating_location: number | null
          rating_student_life: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          building_id: number
          comment?: string | null
          created_at?: string
          id?: string
          is_anonymous?: boolean
          rating: number
          rating_community?: number | null
          rating_location?: number | null
          rating_student_life?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          building_id?: number
          comment?: string | null
          created_at?: string
          id?: string
          is_anonymous?: boolean
          rating?: number
          rating_community?: number | null
          rating_location?: number | null
          rating_student_life?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_reviews_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "master_housing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_setups: {
        Row: {
          author_name: string | null
          caption: string | null
          created_at: string | null
          dorm_id: number | null
          dorm_name: string
          id: number
          image_url: string
          is_hidden: boolean
          likes: number | null
          report_uuid: string
          tags: Json | null
          tiktok_url: string | null
          university_id: string | null
          user_id: string | null
        }
        Insert: {
          author_name?: string | null
          caption?: string | null
          created_at?: string | null
          dorm_id?: number | null
          dorm_name: string
          id?: number
          image_url: string
          is_hidden?: boolean
          likes?: number | null
          report_uuid?: string
          tags?: Json | null
          tiktok_url?: string | null
          university_id?: string | null
          user_id?: string | null
        }
        Update: {
          author_name?: string | null
          caption?: string | null
          created_at?: string | null
          dorm_id?: number | null
          dorm_name?: string
          id?: number
          image_url?: string
          is_hidden?: boolean
          likes?: number | null
          report_uuid?: string
          tags?: Json | null
          tiktok_url?: string | null
          university_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_setups_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      universities: {
        Row: {
          city: string | null
          created_at: string
          email_domains: string[]
          feature_flags: Json
          id: string
          is_active: boolean
          name: string
          short_name: string
          slug: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          email_domains?: string[]
          feature_flags?: Json
          id?: string
          is_active?: boolean
          name: string
          short_name: string
          slug: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          created_at?: string
          email_domains?: string[]
          feature_flags?: Json
          id?: string
          is_active?: boolean
          name?: string
          short_name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      university_admin_leads: {
        Row: {
          admin_email: string
          admin_name: string
          admin_role: string | null
          created_at: string
          id: string
          referred_by_email: string | null
          school_domain: string
        }
        Insert: {
          admin_email: string
          admin_name: string
          admin_role?: string | null
          created_at?: string
          id?: string
          referred_by_email?: string | null
          school_domain?: string
        }
        Update: {
          admin_email?: string
          admin_name?: string
          admin_role?: string | null
          created_at?: string
          id?: string
          referred_by_email?: string | null
          school_domain?: string
        }
        Relationships: []
      }
      university_resources: {
        Row: {
          audience: string
          category: string
          created_at: string
          created_by: string | null
          description: string
          icon_key: string | null
          id: string
          is_active: boolean
          slug: string
          sort_order: number
          title: string
          university_id: string
          updated_at: string
          updated_by: string | null
          url: string
        }
        Insert: {
          audience?: string
          category: string
          created_at?: string
          created_by?: string | null
          description?: string
          icon_key?: string | null
          id?: string
          is_active?: boolean
          slug: string
          sort_order?: number
          title: string
          university_id: string
          updated_at?: string
          updated_by?: string | null
          url: string
        }
        Update: {
          audience?: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          icon_key?: string | null
          id?: string
          is_active?: boolean
          slug?: string
          sort_order?: number
          title?: string
          university_id?: string
          updated_at?: string
          updated_by?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "university_resources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "university_resources_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "university_resources_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      university_waitlist: {
        Row: {
          created_at: string
          email: string
          email_domain: string
          id: string
          launch_notified_at: string | null
          school_id: string | null
          school_name: string | null
        }
        Insert: {
          created_at?: string
          email: string
          email_domain?: string
          id?: string
          launch_notified_at?: string | null
          school_id?: string | null
          school_name?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          email_domain?: string
          id?: string
          launch_notified_at?: string | null
          school_id?: string | null
          school_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "university_waitlist_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      user_classes: {
        Row: {
          building_id: string | null
          color: string | null
          created_at: string
          days: string[]
          end_time: string | null
          id: string
          label: string
          override_building_id: string | null
          override_room: string | null
          room: string | null
          section_id: string | null
          start_time: string | null
          term: string | null
          user_id: string
        }
        Insert: {
          building_id?: string | null
          color?: string | null
          created_at?: string
          days?: string[]
          end_time?: string | null
          id?: string
          label: string
          override_building_id?: string | null
          override_room?: string | null
          room?: string | null
          section_id?: string | null
          start_time?: string | null
          term?: string | null
          user_id: string
        }
        Update: {
          building_id?: string | null
          color?: string | null
          created_at?: string
          days?: string[]
          end_time?: string | null
          id?: string
          label?: string
          override_building_id?: string | null
          override_room?: string | null
          room?: string | null
          section_id?: string | null
          start_time?: string | null
          term?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_classes_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_classes_override_building_id_fkey"
            columns: ["override_building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_classes_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "course_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      user_dorm_rankings: {
        Row: {
          created_at: string
          dorm_id: number
          group_id: string | null
          id: string
          rank_order: number
          user_id: string
        }
        Insert: {
          created_at?: string
          dorm_id: number
          group_id?: string | null
          id?: string
          rank_order: number
          user_id: string
        }
        Update: {
          created_at?: string
          dorm_id?: number
          group_id?: string | null
          id?: string
          rank_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_dorm_rankings_dorm_id_fkey"
            columns: ["dorm_id"]
            isOneToOne: false
            referencedRelation: "master_housing"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_dorm_rankings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ranking_collaborations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_home_location: {
        Row: {
          building_id: string | null
          label: string | null
          lat: number | null
          lng: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          building_id?: string | null
          label?: string | null
          lat?: number | null
          lng?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          building_id?: string | null
          label?: string | null
          lat?: number | null
          lng?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_home_location_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_logistics_progress: {
        Row: {
          done_ids: string[]
          list_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          done_ids?: string[]
          list_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          done_ids?: string[]
          list_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      marketplace_listings_contact: {
        Row: {
          id: string | null
          instagram_handle: string | null
          phone_number: string | null
          snapchat_handle: string | null
        }
        Insert: {
          id?: string | null
          instagram_handle?: never
          phone_number?: never
          snapchat_handle?: never
        }
        Update: {
          id?: string | null
          instagram_handle?: never
          phone_number?: never
          snapchat_handle?: never
        }
        Relationships: []
      }
      marketplace_public: {
        Row: {
          category: string | null
          condition: string | null
          created_at: string | null
          description: string | null
          id: string | null
          image_urls: string[] | null
          items: Json | null
          meetup_location: string | null
          original_price: number | null
          payment_methods: string[] | null
          price: number | null
          price_negotiable: boolean | null
          seller_name: string | null
          show_instagram: boolean | null
          show_phone: boolean | null
          show_snapchat: boolean | null
          status: string | null
          title: string | null
          university_id: string | null
          verified_at: string | null
        }
        Relationships: []
      }
      public_profiles: {
        Row: {
          avatar_url: string | null
          full_name: string | null
          id: string | null
        }
        Insert: {
          avatar_url?: string | null
          full_name?: string | null
          id?: string | null
        }
        Update: {
          avatar_url?: string | null
          full_name?: string | null
          id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_public_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roommate_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          cleanliness: string | null
          conflict_style: string | null
          created_at: string | null
          current_dorm: string | null
          dealbreakers: string[] | null
          full_name: string | null
          grade_level: string | null
          graduation_semester: string | null
          graduation_year: number | null
          guest_preference: string | null
          guests: string | null
          housing_type: string | null
          id: string | null
          instagram_username: string | null
          interests: string[] | null
          is_public: boolean | null
          is_roommate_searching: boolean | null
          major: string | null
          neighborhood: string | null
          preferred_areas: string[] | null
          profile_photos: string[] | null
          prompts: Json | null
          pronouns: string | null
          school: string | null
          sleep: string | null
          sleep_habit: string | null
          smoking: string | null
          snapchat_username: string | null
          social_level: string | null
          study_style: string | null
          tags: string[] | null
          temp: string | null
          temp_preference: string | null
          university_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          cleanliness?: string | null
          conflict_style?: string | null
          created_at?: string | null
          current_dorm?: string | null
          dealbreakers?: string[] | null
          full_name?: string | null
          grade_level?: string | null
          graduation_semester?: string | null
          graduation_year?: number | null
          guest_preference?: string | null
          guests?: string | null
          housing_type?: string | null
          id?: string | null
          instagram_username?: string | null
          interests?: string[] | null
          is_public?: boolean | null
          is_roommate_searching?: boolean | null
          major?: string | null
          neighborhood?: string | null
          preferred_areas?: string[] | null
          profile_photos?: string[] | null
          prompts?: Json | null
          pronouns?: string | null
          school?: string | null
          sleep?: string | null
          sleep_habit?: string | null
          smoking?: string | null
          snapchat_username?: string | null
          social_level?: string | null
          study_style?: string | null
          tags?: string[] | null
          temp?: string | null
          temp_preference?: string | null
          university_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          cleanliness?: string | null
          conflict_style?: string | null
          created_at?: string | null
          current_dorm?: string | null
          dealbreakers?: string[] | null
          full_name?: string | null
          grade_level?: string | null
          graduation_semester?: string | null
          graduation_year?: number | null
          guest_preference?: string | null
          guests?: string | null
          housing_type?: string | null
          id?: string | null
          instagram_username?: string | null
          interests?: string[] | null
          is_public?: boolean | null
          is_roommate_searching?: boolean | null
          major?: string | null
          neighborhood?: string | null
          preferred_areas?: string[] | null
          profile_photos?: string[] | null
          prompts?: Json | null
          pronouns?: string | null
          school?: string | null
          sleep?: string | null
          sleep_habit?: string | null
          smoking?: string | null
          snapchat_username?: string | null
          social_level?: string | null
          study_style?: string | null
          tags?: string[] | null
          temp?: string | null
          temp_preference?: string | null
          university_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_roommate_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roommate_search_posts_contact: {
        Row: {
          id: string | null
          instagram: string | null
          phone_number: string | null
          snapchat: string | null
        }
        Insert: {
          id?: string | null
          instagram?: never
          phone_number?: never
          snapchat?: never
        }
        Update: {
          id?: string | null
          instagram?: never
          phone_number?: never
          snapchat?: never
        }
        Relationships: []
      }
      seller_rating_stats: {
        Row: {
          avg_stars: number | null
          rating_count: number | null
          seller_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _create_notification: {
        Args: { p_payload: Json; p_recipient: string; p_type: string }
        Returns: undefined
      }
      actor_is_superadmin: { Args: { p_actor: string }; Returns: boolean }
      admin_list_held_listings: {
        Args: { p_university_id?: string }
        Returns: {
          created_at: string
          image_urls: string[]
          listing_id: string
          moderated_at: string
          moderation_categories: string[]
          moderation_decision: string
          moderation_reason: string
          owner_id: string
          owner_name: string
          price: number
          title: string
        }[]
      }
      am_i_in_group_with_user: {
        Args: { target_user_id: string }
        Returns: boolean
      }
      apply_tenant_isolation: { Args: { p_table: unknown }; Returns: undefined }
      claim_service_post: { Args: { p_listing_id: string }; Returns: string }
      complete_service_post: { Args: { p_listing_id: string }; Returns: string }
      has_completed_service_between: {
        Args: { u1: string; u2: string }
        Returns: boolean
      }
      // Hand-added ahead of the next full regen, matching what one would emit
      // (migration 20260924000000). types.ts deliberately lags prod — see
      // .claude/rules/supabase-backend.md — so a batch regen would drag in
      // unrelated drift for one new RPC.
      service_completion_count: { Args: { p_user_id: string }; Returns: number }
      service_category_scope: { Args: { p_category: string }; Returns: string }
      shares_remote_services: { Args: { p_university_id: string }; Returns: boolean }
      can_start_conversation: {
        Args: { p_recipient: string; p_sender: string }
        Returns: boolean
      }
      check_group_access: { Args: { check_group_id: string }; Returns: boolean }
      check_rate_limit: {
        Args: {
          p_bucket_key: string
          p_max_requests: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      claim_marketplace_listing_moderation: {
        Args: {
          p_listing_id: string
          p_stale_before: string
          p_user_id: string
        }
        Returns: {
          category: string
          description: string
          id: string
          image_urls: string[]
          moderation_started_at: string
          price: number
          title: string
        }[]
      }
      claim_pending_admin_invites: { Args: never; Returns: number }
      clear_group_checklist: {
        Args: { target_group_id: string }
        Returns: undefined
      }
      clear_group_pin: { Args: { p_group_id: string }; Returns: undefined }
      clone_personal_to_group: {
        Args: { target_group_id: string }
        Returns: undefined
      }
      conversation_has_messages: { Args: { conv_id: string }; Returns: boolean }
      create_checklist_share_link: {
        Args: { p_group_id: string; p_label?: string }
        Returns: string
      }
      create_ranking_group: {
        Args: {
          p_dorm_name?: string
          p_group_name?: string
          p_group_type?: string
          p_member_ids?: string[]
          p_term?: string
          p_unit_label?: string
        }
        Returns: string
      }
      current_academic_year: { Args: never; Returns: string }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      current_term: {
        Args: { p_university_id: string }
        Returns: {
          code: string
          created_at: string
          ends_at: string
          id: string
          name: string
          starts_at: string
          university_id: string
        }
        SetofOptions: {
          from: "*"
          to: "academic_terms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_university_id: { Args: never; Returns: string }
      decrement_product_hearts: {
        Args: { product_id: string }
        Returns: undefined
      }
      delete_group_message: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      drop_all_policies_for_table: {
        Args: { target_schema: string; target_table: string }
        Returns: undefined
      }
      ensure_building_chat: { Args: { b_id: number }; Returns: string }
      ensure_floor_chat: {
        Args: { b_id: number; p_floor: string }
        Returns: string
      }
      estimate_ad_reach: {
        Args: { p_class_years?: number[]; p_university: string }
        Returns: number
      }
      extract_listing_id: { Args: { url: string }; Returns: string }
      get_admin_metrics: { Args: { p_university_id?: string }; Returns: Json }
      get_auth_methods_for_email: { Args: { p_email: string }; Returns: Json }
      get_blocked_relationship_user_ids: { Args: never; Returns: string[] }
      get_building_chat_links: {
        Args: { b_id: number; year?: string }
        Returns: {
          academic_year: string
          building_id: number
          created_at: string
          floor: string
          id: string
          label: string
          platform: string
          report_count: number
          submitted_by: string
          submitter_display_name: string
          url: string
        }[]
      }
      get_building_chats: {
        Args: { b_id: number }
        Returns: {
          am_i_member: boolean
          created_at: string
          floor: string
          id: string
          last_message: string
          member_count: number
          name: string
          updated_at: string
        }[]
      }
      get_building_residents: {
        Args: { b_id: number }
        Returns: {
          avatar_url: string
          current_floor: string
          full_name: string
          id: string
          is_self: boolean
          move_in_date: string
        }[]
      }
      get_content_reports: {
        Args: { content_type_filter?: string; p_university_id?: string }
        Returns: {
          category: string
          content_context: string
          content_id: string
          content_owner_id: string
          content_owner_name: string
          content_preview_body: string
          content_preview_title: string
          content_type: string
          escalated_at: string
          reason: string
          report_id: string
          reported_at: string
          reporter_id: string
          reporter_name: string
        }[]
      }
      get_dorm_reviews: {
        Args: { p_building_id: number; p_limit?: number }
        Returns: {
          author_name: string
          created_at: string
          id: string
          is_anonymous: boolean
          is_mine: boolean
          rating: number
          rating_community: number
          rating_location: number
          rating_student_life: number
        }[]
      }
      get_dorm_review_stats: {
        Args: { p_building_id: number }
        Returns: {
          avg_community: number
          avg_location: number
          avg_overall: number
          avg_room: number
          avg_student_life: number
          review_count: number
        }[]
      }
      get_group_checklist: {
        Args: { query_group_id: string }
        Returns: {
          assigned_to: string | null
          category: string
          created_at: string | null
          description: string | null
          estimated_price: number | null
          group_id: string | null
          icon_name: string | null
          id: string
          image_url: string | null
          is_checked: boolean | null
          is_custom: boolean | null
          is_night_one: boolean
          item: string
          link: string | null
          link_image: string | null
          link_title: string | null
          needs_purchase: boolean | null
          note: string | null
          order_index: number | null
          position: number | null
          split_cost: boolean | null
          split_participant_ids: string[] | null
          split_percentages: Json | null
          status: string | null
          user_id: string
          variant_label: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "checklist_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_group_checklist_settlement_context: {
        Args: { p_group_id: string }
        Returns: Json
      }
      get_group_invite_preview: {
        Args: { p_code: string }
        Returns: {
          caller_status: string
          dorm_name: string
          group_id: string
          group_name: string
          group_type: string
          member_count: number
          owner_name: string
        }[]
      }
      get_groups_i_own: { Args: never; Returns: string[] }
      get_marketplace_preview: {
        Args: { p_university_id?: string }
        Returns: Json
      }
      get_my_accepted_group_ids: { Args: never; Returns: string[] }
      get_my_all_group_ids: { Args: never; Returns: string[] }
      get_my_security_events: { Args: never; Returns: Json }
      get_my_sessions: {
        Args: never
        Returns: {
          created_at: string
          id: string
          ip: string
          is_current: boolean
          last_seen_at: string
          user_agent: string
        }[]
      }
      get_setup_comment_likes: {
        Args: { p_author_id: string; p_setup_id: number }
        Returns: {
          comment_id: number
          like_count: number
          liked_by_author: boolean
          liked_by_me: boolean
        }[]
      }
      get_setups_preview: { Args: { p_university_id?: string }; Returns: Json }
      get_shared_checklist: { Args: { p_token: string }; Returns: Json }
      get_university_admins: {
        Args: { p_university_id?: string }
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          university_id: string
        }[]
      }
      get_waitlist_rank: { Args: { p_domain: string }; Returns: Json }
      get_weekly_digest_metrics: {
        Args: { p_since: string; p_university_id: string }
        Returns: {
          new_listings: number
          new_signups: number
          open_reports: number
          university_name: string
        }[]
      }
      group_university: { Args: { p_group_id: string }; Returns: string }
      has_accepted_conversation_between: {
        Args: { u1: string; u2: string }
        Returns: boolean
      }
      has_admin_scope: { Args: { p_scope: string }; Returns: boolean }
      has_advertiser_invitation: { Args: { p_email: string }; Returns: boolean }
      increment_product_hearts: {
        Args: { product_id: string }
        Returns: undefined
      }
      is_advertiser_account: { Args: never; Returns: boolean }
      is_blocked_between: { Args: { u1: string; u2: string }; Returns: boolean }
      is_chat_group_member: { Args: { gid: string }; Returns: boolean }
      is_conversation_blocked: { Args: { conv_id: string }; Returns: boolean }
      is_group_ra: { Args: { p_group_id: string }; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      join_group_via_invite: { Args: { p_code: string }; Returns: string }
      join_my_building_rooms: { Args: never; Returns: Json }
      mark_notifications_read: { Args: { p_ids?: string[] }; Returns: number }
      mint_backup_codes: { Args: never; Returns: string[] }
      next_term: {
        Args: { p_university_id: string }
        Returns: {
          code: string
          created_at: string
          ends_at: string
          id: string
          name: string
          starts_at: string
          university_id: string
        }
        SetofOptions: {
          from: "*"
          to: "academic_terms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      profile_university: { Args: { p_user: string }; Returns: string }
      reorder_checklist_items: { Args: { p_updates: Json }; Returns: number }
      reset_checklist_custom: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      reset_checklist_defaults: {
        Args: { p_list_type?: string; p_user_id: string }
        Returns: undefined
      }
      resolve_school_by_domain: { Args: { p_domain: string }; Returns: Json }
      revoke_admin_invitation: {
        Args: { p_invite_id: string }
        Returns: undefined
      }
      revoke_checklist_share_link: {
        Args: { p_token: string }
        Returns: undefined
      }
      revoke_my_other_sessions: { Args: never; Returns: number }
      revoke_my_session: { Args: { p_session_id: string }; Returns: boolean }
      rotate_group_invite_code: {
        Args: { p_group_id: string }
        Returns: string
      }
      search_users: {
        Args: { search_query: string }
        Returns: {
          avatar_url: string
          full_name: string
          id: string
        }[]
      }
      seed_community_welcome: {
        Args: { p_group_id: string; p_room_name: string }
        Returns: undefined
      }
      set_admin_role: {
        Args: {
          p_new_role: Database["public"]["Enums"]["app_role"]
          p_target_id: string
        }
        Returns: undefined
      }
      set_group_member_ra: {
        Args: { p_group_id: string; p_is_ra: boolean; p_user_id: string }
        Returns: undefined
      }
      set_group_pin: {
        Args: { p_group_id: string; p_message_id: string }
        Returns: undefined
      }
      set_shared_item_status: {
        Args: { p_item_id: string; p_status: string; p_token: string }
        Returns: undefined
      }
      set_university_feature_flags: {
        Args: { p_flags: Json; p_university_id: string }
        Returns: Json
      }
      sync_group_rankings_from_members: {
        Args: { p_group_id: string }
        Returns: undefined
      }
      use_backup_code: { Args: { p_code: string }; Returns: boolean }
      user_current_dorm_matches_building: {
        Args: { b_id: number }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "user" | "university_admin" | "superadmin"
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
      app_role: ["user", "university_admin", "superadmin"],
    },
  },
} as const
