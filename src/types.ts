export type AiProviderName = 'anthropic' | 'gemini';

export interface Business {
  id: number;
  name: string;
  domain: string;
  voice_profile: string;
  ai_provider: AiProviderName;
  active: boolean;
}

export interface Subreddit {
  id: number;
  business_id: number;
  subreddit_name: string;
  active: boolean;
  last_suggested_at: Date | null;
}

export interface Keyword {
  id: number;
  business_id: number;
  phrase: string;
  active: boolean;
}

export type MatchStatus = 'new' | 'emailed' | 'responded' | 'ignored' | 'irrelevant';

export interface Match {
  id: number;
  business_id: number;
  subreddit_name: string;
  reddit_post_id: string;
  post_title: string;
  post_body: string;
  post_url: string;
  author: string;
  created_utc: Date;
  matched_keyword: string;
  status: MatchStatus;
  ai_draft_response: string | null;
  found_at: Date;
}

export interface RedditPost {
  id: string; // fullname without prefix, e.g. "1abcde"
  title: string;
  selftext: string;
  permalink: string;
  author: string;
  subreddit: string;
  created_utc: number; // unix seconds
}

export interface SubredditRule {
  short_name: string;
  description: string;
  kind: string; // "link" | "comment" | "all"
  violation_reason: string;
}

export interface SubredditAbout {
  title: string;
  public_description: string;
  submit_text: string;
  subreddit_type: string;
}

export interface PostSuggestion {
  id: number;
  business_id: number;
  subreddit_name: string;
  rules_json: SubredditRule[];
  submit_text: string;
  chosen_reason: string;
  key_rules_summary: string;
  post_title: string;
  post_body: string;
  unverified_flags: string;
  status: 'new' | 'emailed' | 'posted' | 'skipped';
}
