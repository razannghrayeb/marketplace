import type { User, UserType } from '@/store/auth'

/** Map backend auth / profile payloads to store `User` */
export function mapApiUser(
  raw: {
    id: number
    email: string
    is_admin?: boolean
    user_type?: UserType
    created_at?: string
    is_active?: boolean
  },
  fallbackUserType?: UserType
): User {
  return {
    id: raw.id,
    email: raw.email,
    is_admin: Boolean(raw.is_admin),
    user_type: raw.user_type ?? fallbackUserType,
    created_at: raw.created_at,
  }
}
