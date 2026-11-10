// Starter templates. Creating a workspace from one seeds a few files and
// suggests first prompts, so a new group sees something useful right away.

export type Template = {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  instructions: string; // how the agent should behave in this workspace
  files: { path: string; content: string }[];
  prompts: string[]; // suggested first prompts, shown as one-click chips
};

export const TEMPLATES: Template[] = [
  {
    id: "trip",
    name: "Plan a group trip",
    emoji: "🏔️",
    blurb: "Itinerary, packing list and budget the whole group can shape.",
    instructions:
      "This workspace plans a group trip. Keep itinerary.md, packing.md and budget.md up to date. " +
      "Use the browser to check real prices, hours and travel times, and cite links. " +
      "When people disagree, lay out the options side by side instead of picking one.",
    files: [
      {
        path: "itinerary.md",
        content:
          "# Trip itinerary\n\n- **Where:** TBD\n- **When:** TBD\n- **Who:** TBD\n\n## Day 1\n- \n\n## Day 2\n- \n\n## Ideas we haven't decided on\n- \n",
      },
      { path: "packing.md", content: "# Packing list\n\n## Shared gear (who's bringing it)\n- [ ] \n\n## Everyone\n- [ ] \n" },
      { path: "budget.md", content: "# Budget\n\n| Item | Cost | Paid by | Split |\n|---|---|---|---|\n| | | | |\n" },
    ],
    prompts: [
      "We're thinking of a 3 day trip. Suggest 3 destinations that fit and compare them in itinerary.md",
      "Look up flights or drive times and add them to the itinerary",
      "Make a packing list for the trip in packing.md",
    ],
  },
  {
    id: "school",
    name: "School / group project",
    emoji: "📚",
    blurb: "Split the work, research together, and draft the deliverable.",
    instructions:
      "This workspace is a group school project. Keep plan.md as the source of truth for who is doing what and when. " +
      "Write in plain, clear language, cite sources with links, and never invent quotes or data.",
    files: [
      {
        path: "plan.md",
        content:
          "# Project plan\n\n- **Assignment:** TBD\n- **Due:** TBD\n\n## Tasks\n| Task | Owner | Due | Status |\n|---|---|---|---|\n| | | | |\n",
      },
      { path: "notes.md", content: "# Research notes\n\n- \n" },
      { path: "draft.md", content: "# Draft\n\n" },
    ],
    prompts: [
      "Here's our assignment: … Break it into tasks and fill in plan.md",
      "Research the topic and add key sources with links to notes.md",
      "Write a first outline in draft.md",
    ],
  },
  {
    id: "app",
    name: "Build an app",
    emoji: "🛠️",
    blurb: "Describe it, then watch the AI build it. Everyone can steer.",
    instructions:
      "This workspace builds a small web app. Prefer a single index.html with inline CSS/JS unless asked otherwise, " +
      "so it previews instantly. Explain what you changed in one or two sentences.",
    files: [
      { path: "README.md", content: "# Our app\n\nWhat it does:\n\nWho it's for:\n" },
    ],
    prompts: [
      "Build a simple, good-looking landing page for our idea in index.html",
      "Make a to-do list app in index.html that saves to localStorage",
      "Add a dark mode toggle",
    ],
  },
  {
    id: "blank",
    name: "Blank workspace",
    emoji: "⛺",
    blurb: "Start from nothing.",
    instructions: "",
    files: [],
    prompts: [
      "What can you help us with in this workspace?",
      "Research a topic and write a short summary to notes.md",
    ],
  },
];

export const templateById = (id?: string) => TEMPLATES.find((t) => t.id === id);
