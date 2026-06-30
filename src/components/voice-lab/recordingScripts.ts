// Read-aloud passages for the Voice Lab recording UI. Each is phonetically
// varied (covers a broad spread of vowels/consonants) and ~30–45 seconds to read
// at a natural pace, so a single pass comfortably clears MIN_DURATION_SEC (30s).
//
// These are display-only prompts — nothing here is uploaded or fed to training;
// the recorded audio is what matters. The goal is just to give the user *something*
// to say so the captured voice is steady and well-covered. Because clones here are
// frequently used for SINGING, the UI pairs these with a reminder to vary pitch
// and dynamics (low/high, soft/loud), not read flatly.

export interface RecordingScript {
  id: string
  // Short human label, shown next to the passage.
  title: string
  text: string
}

export const RECORDING_SCRIPTS: RecordingScript[] = [
  {
    id: 'bright-morning',
    title: 'A Bright Morning',
    text:
      'The bright orange sun climbed quietly over the hills as I walked along the river. ' +
      'A cool breeze brushed past me, carrying the smell of fresh rain and damp earth. ' +
      'Birds called from the tall trees, and somewhere far away a temple bell rang slowly. ' +
      'I love these calm, golden mornings — they make even the busiest day feel gentle and unhurried. ' +
      'Now I will hum a soft tune, then lift my voice high and strong, just to hear how it sounds.',
  },
  {
    id: 'old-radio',
    title: 'The Old Radio',
    text:
      'In the corner of the room sat an old wooden radio, its dial glowing a warm amber. ' +
      'My grandfather would switch it on every evening and close his eyes while the music played. ' +
      'Sometimes it was a quiet ghazal, sometimes a loud, joyful song that filled the whole house. ' +
      'He taught me that a voice can whisper like a secret or ring out like a bell across a valley. ' +
      'Let me try both now — first low and breathy, then bright and clear, sliding up and down my range.',
  },
  {
    id: 'journey-train',
    title: 'A Journey by Train',
    text:
      'The train pulled away from the crowded platform with a long, low whistle and a gentle jolt. ' +
      'Outside the window, green fields, dusty villages, and busy markets rushed by in a colourful blur. ' +
      'A child laughed nearby, vendors shouted prices for tea and warm snacks, and the wheels kept their steady rhythm. ' +
      'Travelling like this always feels like a small adventure, full of new faces and unexpected stories. ' +
      'Now I will sing a few rising notes, soft then loud, to stretch my voice from its lowest to its highest.',
  },
]

// Pick the script that comes after the given id, wrapping around — used by the
// "new script" shuffle button so each press advances to a different passage.
export function nextScript(currentId: string): RecordingScript {
  const i = RECORDING_SCRIPTS.findIndex((s) => s.id === currentId)
  return RECORDING_SCRIPTS[(i + 1) % RECORDING_SCRIPTS.length]
}
