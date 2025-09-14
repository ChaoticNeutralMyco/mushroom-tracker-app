/**
 * Steps map: routeKey -> array of steps
 * If selector is present and found, it gets a spotlight; otherwise the tooltip centers.
 * Bump TOUR_VERSION whenever steps change to auto-reset seen flags.
 */
export const TOUR_VERSION = 2;

const steps = {
  dashboard: [
    {
      title: "Welcome to your Dashboard",
      body: "This is your mission control. Track active grows, cost, and quick actions at a glance.",
    },
    {
      title: "Create your first grow",
      body: "Click the “New Grow” button to start a batch. You can choose Agar, LC, Grain Jar, or Bulk.",
      selector: '[data-tour="new-grow"]'
    },
    {
      title: "Filters & stages",
      body: "Use these chips to quickly narrow grows by status (Inoculated, Colonizing, Fruiting, etc.).",
      selector: '[data-tour="stage-filters"]'
    }
  ],

  settings: [
    { title: "Theme & style", body: "Pick Light or Dark and switch the Theme Style to “Chaotic”.", selector: '[data-tour="theme-style"]' },
    { title: "Accent color", body: "Choose an accent color. It won’t change the Chaotic background.", selector: '[data-tour="accent-color"]' },
    { title: "Units & Reminders", body: "Configure units and enable local reminders to stay on top of tasks.", selector: '[data-tour="units-block"]' }
  ],

  analytics: [
    { title: "Visualize your data", body: "Charts summarize yields, costs, contamination rates, and more." },
    { title: "Change the chart", body: "Use this dropdown to switch datasets like burn rate, throughput, or recipe usage.", selector: '[data-tour="analytics-dataset"]' },
    { title: "Export", body: "Export CSV or JSON snapshots for backups or analysis.", selector: '[data-tour="analytics-export"]' }
  ],

  calendar: [
    { title: "Calendar view", body: "Plan tasks around inoculation and harvest windows." },
    { title: "Create item", body: "Click a day to add a reminder or note." }
  ],

  timeline: [
    { title: "Timeline", body: "See historical events like inoculations and harvests in order." }
  ],

  recipes: [
    { title: "Recipes", body: "Manage inputs and quantities used for a grow. These power analytics like burn rate." }
  ],

  strains: [
    { title: "Strains", body: "Add strains, aliases, and notes. These labels show up in your grows and analytics." }
  ],

  labels: [
    { title: "Labels", body: "Print or view labels, and manage label presets for jars and tubs." }
  ],

  archive: [
    { title: "Archive", body: "Completed or contaminated grows live here, keeping your dashboard clean." }
  ],

  cog: [
    {
      title: "Cost of Goods (COG)",
      body: "Track supplies and costs that feed into recipes and analytics.",
      selector: '[data-tour="cog-root"]'
    },
    {
      title: "Tips",
      body: "Add supplies, organize into recipes, then apply recipes to grows for automatic cost estimates."
    }
  ]
};

export default steps;
