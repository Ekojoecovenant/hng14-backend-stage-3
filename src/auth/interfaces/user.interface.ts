export interface GithubProfile {
  github_id: string;
  username: string;
  email?: string;
  avatar_url?: string;
}

export interface JwtPayload {
  sub: string;
  github_id: string;
  role: 'ADMIN' | 'ANALYST';
}

export interface AuthResponse {
  status: string;
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    username: string;
    role: 'ADMIN' | 'ANALYST';
  };
}
