export type McEventType =
  | 'session_start'
  | 'session_stop'
  | 'session_killed_watchdog'
  | 'message_received'
  | 'reply_sent'
  | 'scheduler_fired'
  | 'specclaw_status_changed';

export interface McEvent {
  instance_id: string;   // SHA1(realpath(MCD_CHANNELS_DIR))
  host: string;          // os.hostname()
  user: string;          // os.userInfo().username
  ts: string;            // ISO 8601
  type: McEventType;
  payload: Record<string, unknown>;
}
