export const contentAnnouncements = [
  {
    id: 901,
    title: 'First expedition briefing',
    message:
      '<p>Pack your <strong>compass</strong>.</p><script>ignore()</script>',
    posted_at: '2026-08-12T02:00:00Z',
    html_url: 'https://canvas.example.edu/courses/101/announcements/901',
  },
  {
    id: 902,
    title: 'Newest expedition briefing',
    message:
      '<p>Meet at <a href="https://canvas.example.edu/map">the map room</a>.</p>',
    posted_at: '2026-08-13T05:30:00Z',
    html_url: 'https://canvas.example.edu/courses/101/announcements/902',
  },
] as const;

export const contentModules = [
  {
    id: 701,
    name: 'Fieldwork',
    position: 2,
    unlock_at: null,
    state: 'active',
    items: [
      {
        id: 801,
        module_id: 701,
        type: 'Assignment',
        title: 'Trail journal',
        position: 2,
        html_url: 'https://canvas.example.edu/courses/101/assignments/801',
        completion_requirement: {
          type: 'must_submit',
          min_score: 0,
          completed: false,
        },
      },
      {
        id: 802,
        module_id: 701,
        type: 'Page',
        title: 'Locked trail map',
        position: 1,
        html_url: 'https://canvas.example.edu/courses/101/pages/trail-map',
        completion_requirement: { type: 'must_view', completed: true },
        content_details: {
          locked_for_user: true,
          lock_explanation: 'Complete the orientation first.',
        },
      },
    ],
  },
  {
    id: 702,
    name: 'Orientation',
    position: 1,
    state: 'active',
  },
] as const;

export const fallbackModuleItems = [
  {
    id: 803,
    module_id: 702,
    type: 'ExternalUrl',
    title: 'Safety handbook',
    position: 2,
    html_url: 'https://canvas.example.edu/courses/101/modules/items/803',
  },
  {
    id: 804,
    module_id: 702,
    type: 'Page',
    title: 'Welcome',
    position: 1,
    html_url: 'https://canvas.example.edu/courses/101/pages/welcome',
  },
] as const;

export const contentPage = {
  page_id: 1001,
  url: 'week-1-notes',
  title: 'Week 1 Notes',
  body: '<h2>First steps</h2><p>Bring a <a href="https://canvas.example.edu/compass">compass</a>.</p><style>hidden { color: red; }</style>',
  updated_at: '2026-08-12T02:00:00Z',
  html_url: 'https://canvas.example.edu/courses/101/pages/week-1-notes',
} as const;
