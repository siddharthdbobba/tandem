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
    id: "study",
    name: "Study group",
    emoji: "🧠",
    blurb: "Shared notes, practice questions and a plan before the exam.",
    instructions:
      "This workspace is a study group. Explain things simply with examples, quiz people when asked, " +
      "and keep notes.md organized by topic. Cite sources for facts. Never just hand over answers to graded work.",
    files: [
      { path: "notes.md", content: "# Study notes\n\n- **Class:** TBD\n- **Exam date:** TBD\n\n## Topics\n- \n" },
      { path: "questions.md", content: "# Practice questions\n\n" },
    ],
    prompts: [
      "Here are the topics for our exam: … Make a study plan for the next week in notes.md",
      "Write 10 practice questions on the first topic in questions.md, answers at the bottom",
      "Explain the hardest topic like we're new to it, with an example",
    ],
  },
  {
    id: "party",
    name: "Plan an event",
    emoji: "🎉",
    blurb: "Birthday, formal or potluck: guest list, tasks and a budget.",
    instructions:
      "This workspace plans an event. Keep plan.md (date, place, tasks with owners) and budget.md current. " +
      "Use the browser to check real venues, prices and hours, and include links.",
    files: [
      { path: "plan.md", content: "# Event plan\n\n- **What:** TBD\n- **When:** TBD\n- **Where:** TBD\n\n## Tasks\n| Task | Who | Done |\n|---|---|---|\n| | | |\n" },
      { path: "guests.md", content: "# Guests\n\n- \n" },
      { path: "budget.md", content: "# Budget\n\n| Item | Cost | Paid by |\n|---|---|---|\n| | | |\n" },
    ],
    prompts: [
      "We're planning a birthday dinner for 10 people near downtown. Find 3 restaurant options and add them to plan.md",
      "Split the tasks in plan.md fairly between the people in this workspace",
      "Make a shopping list and estimate the budget in budget.md",
    ],
  },
  {
    id: "side",
    name: "Side project",
    emoji: "🚀",
    blurb: "Brainstorm, research and pitch an idea with co-founders.",
    instructions:
      "This workspace develops a side project or startup idea. Be candid about risks, back claims with sources, " +
      "and keep idea.md as the one-page summary of what we're building, for whom, and why now.",
    files: [
      { path: "idea.md", content: "# The idea\n\n- **Problem:** TBD\n- **For whom:** TBD\n- **Solution:** TBD\n- **Why now:** TBD\n" },
      { path: "research.md", content: "# Research\n\n## Competitors\n- \n" },
    ],
    prompts: [
      "Here's our idea: … Fill in idea.md and list the 3 biggest risks",
      "Research competitors on the web and summarize them in research.md with links",
      "Draft a one-page pitch we could send to a friend for feedback",
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
