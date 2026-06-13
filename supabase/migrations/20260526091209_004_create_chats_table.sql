/*
  # Create chats table for AI conversation storage

  1. New Tables
    - `chats`
      - `id` (uuid, primary key)
      - `user_id` (text, identifier for the user)
      - `platform` (text, platform identifier like 'web', 'mobile')
      - `message` (text, user's message)
      - `response` (text, AI's response)
      - `intent` (text, detected intent like 'price', 'order')
      - `created_at` (timestamp, when conversation occurred)

  2. Security
    - Enable RLS on `chats` table
    - Allow public read access for all users
    - Allow anyone to insert chat messages

  3. Important Notes
    - Stores conversation history for AI assistant
    - Tracks user platform and detected intents
    - Conversations are publicly readable for demo purposes
*/

CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  platform text NOT NULL DEFAULT 'web',
  message text NOT NULL,
  response text NOT NULL,
  intent text DEFAULT 'unknown',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Anyone can read chats"
  ON chats FOR SELECT
  TO public
  USING (true);

-- Allow anyone to insert
CREATE POLICY "Anyone can insert chats"
  ON chats FOR INSERT
  TO public
  WITH CHECK (true);