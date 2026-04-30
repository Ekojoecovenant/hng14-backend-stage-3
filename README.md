# Insighta Labs+ - Backend

Secure Demographic Intelligence Platform with GitHub OAuth, Role-based Access, CLI & Web Portal.

## System Architecture

- **Backend**: NestJS + Prisma + PostgreSQL (Neon)
- **Auth**: GitHub OAuth2 with PKCE + JWT (Access 3min, Refresh 5min with rotation)
- **Roles**: ADMIN (full access), ANALYST (read-only)
- **Interfaces**: REST API + CLI + Web Portal (planned)

## Auth Flow

1. User clicks "Login with GitHub"
2. Backend redirects to GitHub with PKCE
3. GitHub redirects back to `/auth/github/callback`
4. Backend creates/finds user and issues JWT tokens
5. Refresh token rotation on every refresh
6. Logout invalidates refresh token

## CLI Usage

```bash
insighta auth login
insighta profiles list --gender male --country NG
insighta profiles search "young males from nigeria"
insighta profiles create --name "Harriet Tubman"
insighta profiles export --format csv
```

## Token Handling

- Access Token: 3 minutes
- Refresh Token: 5 minutes with rotation
- Refresh tokens are stored server-side and invalidated on logout

## Role Enforcement

- Uses `@Roles('ADMIN')` decorator + `RolesGuard`
- All protected routes use `JwtAuthGuard`
- Analysts can only read/search
- Admins can create/export

## Natural Language Parsing

Rule-based parser that detects:

- Gender keywords (`male`, `female`)
- Age groups (`young`, `teenager`, `adult`, `senior`)
- Age ranges (`above 30`, `below 40`)
- Country names → ISO codes
