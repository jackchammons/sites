/* The parts of the methodology that are built from data rather than typed:
 * the factor cards, the friction table, and the account of how the index is
 * kept (the life of an entry, the two workflows, the task rotation, what can
 * move a score). The prose around the scoring formulas is in build/page.mjs.
 *
 * Every number here is an export of the module that uses it: rules.js for
 * the worklists, slice.js for the score, census.js for the permit cutoff. The
 * copy names no hour of the day, because a scheduled run starts whenever the
 * runner gets to it. */
import { PILLAR_META } from '../../src/render.js';
import { esc } from '../html.mjs';
import {
  DEFAULT_WEIGHTS, ALGORITHM, CRITICAL_BOOST_CAP, MENTION_HALF_LIFE_MONTHS, COVERAGE_WINDOW_MONTHS,
  STALENESS_PER_WEEK, MAX_STALENESS_DECAY
} from '../../src/slice.js';
import { PER_PASS, RETRY_DAYS, ROTATION } from '../../src/rules.js';
import { INSPECTION_CUTOFF_MONTHS } from '../../src/census.js';
import { TASKS, taskRows, outsideRotation } from '../tasks.mjs';

const FACTOR_COPY = {
  reputation:      'Standing earned over time: years in business and whether the press keeps coming back. Computed from data; it carries weight only when it is on file and would not lower the score.',
  critical:        'A critic base rating, lifted a bounded amount by the press coverage the research pass files against the entry.',
  craft:           'The pizza itself: dough, fermentation, bake, and what goes on top. Graded by the research agent from published coverage, with the sources it read.',
  distinctiveness: 'Does it own a lane in this city, or is it a competent copy of someone else? Graded the same way as craft.',
  value:           'Quality delivered per dollar: the craft and reception scores, scaled by the price tier. Computed.'
};

/* The life of a pizzeria in the index, stage by stage. `exit` is a way out of
 * a stage and `enter` a second way into it; both are drawn beside the stage
 * they belong to. */
export const LIFE_STAGES = [
  { key: 'register', title: 'Permit register',
    text: 'King County lists every kitchen that holds a health permit.' },
  { key: 'candidate', title: 'Candidate',
    text: `A Seattle permit that names pizza, inspected in the last ${INSPECTION_CUTOFF_MONTHS} months. A lead, not an entry.`,
    exit: { title: 'Settled on the name',
            text: 'A permit for a pizzeria already on file is tied to that entry. A national chain is excluded.' } },
  { key: 'census', title: 'Census verdict',
    text: `The census task checks it on the open web, up to ${PER_PASS.census} per pass. Real, open and pizza-forward: it joins the directory.`,
    exit: { title: 'Set aside',
            list: ['national chain', 'not pizza-forward', 'could not be verified', 'closed'],
            text: 'A chain stays out for good. The other three return to the queue if the register records a later inspection.' } },
  { key: 'on-file', title: 'On file, unrated',
    text: 'In the directory and on the map, with no score.',
    enter: { title: 'Also joins here',
             text: 'A pizzeria the discovery task finds in local coverage.' } },
  { key: 'rating', title: 'Rating pass',
    text: `The rating task reads what has been published about it, up to ${PER_PASS.rating} entries per pass, and rates it from that.`,
    exit: { title: 'No criticism found',
            text: `Stays unrated. Tried again after ${RETRY_DAYS.rating} days.` } },
  { key: 'ranked', title: 'Ranked',
    text: 'Scored on every build and listed in the directory by rank.',
    exit: { title: 'Closed',
            text: 'A cited closure takes it out of the ranking. It stays in the directory, struck through.' } },
  { key: 'top-ten', title: 'Top ten',
    text: 'The ten highest scores among open pizzerias.' }
];

/* The two workflows, step by step. `gate` is what stops the run at that step. */
const RESEARCH_STEPS = [
  { title: 'Pick one task',
    text: 'A script reads the dataset and picks the day\'s task (how is below). It writes the brief the agent gets: an explicit worklist and a budget of searches.' },
  { title: 'The agent researches',
    text: 'A Claude agent searches the web and reads pages for that brief. It can write exactly one file, its proposals. It cannot run code, and nothing else it did is carried forward.',
    gate: 'any other file changed, or nothing was written.' },
  { title: 'Each record is validated on its own',
    text: 'A record is dropped, with a warning, when it has no https source, names an entry that is not on file, carries a date in the future or too old to count, gives an address without a street number and a Puget Sound ZIP, contains markup, repeats something already on file, reports a closure on a review site\'s word alone, or proposes a rating that is off the scale, has no published criticism behind it, or is for an entry the agent has already rated. The rest go on.',
    gate: 'the file is not well-formed, or a section is over its size limit.' },
  { title: 'Accepted records are applied',
    text: 'A script writes them into the dataset: new entries, statuses, addresses, press mentions, ratings, census verdicts, and the date of each attempt that found nothing. Next the permit register is read again if the last reading is old enough, which is where new candidates come from.' },
  { title: 'Lint, build, verify',
    text: 'The dataset is linted, then the page is built from it and checked, before anything is saved.',
    gate: 'anything fails.' },
  { title: 'Commit',
    text: 'The data is committed. The run finishing is what starts a publish.' }
];
const PUBLISH_STEPS = [
  { title: 'Checks',
    text: 'Unit tests, the dataset lint, and a build and check of every site.',
    gate: 'anything fails.' },
  { title: 'Feed sweep',
    text: 'Google News is swept for local pizza stories, which become the buzz list. If the feed does not answer, the list stays as it was.' },
  { title: 'Geocode',
    text: 'A Seattle address new to the dataset gets its map coordinates. One that will not resolve is left off the map.' },
  { title: 'Lint',
    text: 'The dataset is linted again, with what the last two steps wrote.',
    gate: 'anything fails.' },
  { title: 'Build every site',
    text: 'Every rated entry is scored from the dataset, and the ten highest open ones are the top ten. Each built page is checked. This week\'s standings are kept, for next week\'s ▲▼ markers and the record chart.',
    gate: 'anything fails.' },
  { title: 'Deploy',
    text: 'The built files replace the live site.' }
];

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const pct = (n, digits) => `${(n * 100).toFixed(digits)}%`;

const lifeHtml = () => {
  const aside = (cls, a) => a ? `
        <div class="life-aside ${cls}"><b>${a.title}</b>${a.list ? `
          <ul>${a.list.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
          <p>${a.text}</p></div>` : '';
  return `
    <ol class="life" aria-label="The life of a pizzeria in the index">${LIFE_STAGES.map(s => `
      <li class="life-step" data-stage="${s.key}">
        <div class="life-box"><b>${s.title}</b><p>${s.text}</p></div>${aside('life-exit', s.exit)}${aside('life-enter', s.enter)}
      </li>`).join('')}
    </ol>`;
};

const stepsHtml = (label, steps) => `
        <ol class="steps" aria-label="${label}">${steps.map(s => `
          <li><b>${s.title}</b>
            <p>${s.text}</p>${s.gate ? `
            <p class="step-gate"><span>Gate</span> The run stops if ${s.gate}</p>` : ''}</li>`).join('')}
        </ol>`;

const TASK_COLUMNS = [['looks', 'Looks at'], ['perPass', 'Per pass'], ['writes', 'May write'],
                      ['nothing', 'Finds nothing'], ['again', 'Looks again']];

/* The explicit roles keep the table a table for a screen reader on a narrow
 * screen, where the stylesheet lays each row out as a block. */
const tasksHtml = () => `
    <table class="tasks" role="table" aria-label="What each task in the rotation does">
      <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Task</th>${
        TASK_COLUMNS.map(([, label]) => `<th scope="col" role="columnheader">${label}</th>`).join('')}</tr></thead>
      <tbody role="rowgroup">${taskRows().map(row => `
        <tr role="row" data-task="${esc(row.name)}"><th scope="row" role="rowheader">${esc(row.name)}</th>${
          TASK_COLUMNS.map(([key, label]) => `<td role="cell" data-l="${label}">${row[key]}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>`;

/* The methodology section's factor cards and friction table, and the account
 * of the automation that follows them. */
export function methodParts(ctx) {
  const { dataset } = ctx;
  const factorCards = Object.keys(DEFAULT_WEIGHTS).map(k => `
        <div class="pillar">
          <div class="w">${DEFAULT_WEIGHTS[k]}<span style="font-size:15px;color:var(--ink-3)">%</span></div>
          <h4><span class="swatch" style="background:${PILLAR_META[k].color}"></span>${PILLAR_META[k].label}</h4>
          <p>${FACTOR_COPY[k]}</p>
        </div>`).join('');

  const frictionRows = Object.entries(dataset.attributeRegistry)
    .filter(([, a]) => a.frictionCost > 0)
    .sort((a, b) => b[1].frictionCost - a[1].frictionCost)
    .map(([, a]) => `<tr><th scope="row">${esc(a.label)}</th><td class="num">−${a.frictionCost.toFixed(1)}</td></tr>`)
    .join('');

  const outside = outsideRotation();
  const automation = `
    <h3 class="method-h" id="lifecycle">From a food permit to the top ten</h3>
    <p class="method-p">
      The life of a pizzeria in the index. Each step forward is taken by one of the research
      tasks; the dashed boxes are the ways out of a step, and one more way in.
    </p>${lifeHtml()}

    <h3 class="method-h" id="runs">What runs, and in what order</h3>
    <p class="method-p">
      Two automated jobs keep the index. The research run sends an agent to find things out and
      files what survives checking. The publish rebuilds the site from the dataset and deploys
      it. Each is a fixed list of steps, and a gate is a point where the run stops if something
      is wrong.
    </p>
    <div class="grid2 runs">
      <div class="mcard">
        <h4>The research run</h4>
        <p class="run-when">Once a day, and whenever it is started by hand</p>${stepsHtml('The research run, step by step', RESEARCH_STEPS)}
      </div>
      <div class="mcard">
        <h4>The publish</h4>
        <p class="run-when">After each research run, once a day on its own schedule, and on every change to the code</p>${stepsHtml('The publish, step by step', PUBLISH_STEPS)}
      </div>
    </div>
    <p class="method-p" style="margin-top:18px">
      The agent never runs code and never writes a score. It proposes facts and ratings with
      their sources; scripts check them, apply them and compute every score. A step that fails
      ends its run: nothing new is committed or deployed, and the last good site stays up.
    </p>

    <h3 class="method-h" id="rotation">How the day's task is chosen</h3>
    <p class="method-p">
      Each research run does one task. The script orders the ${(WORDS[ROTATION.length] ?? String(ROTATION.length)).toLowerCase()} tasks in the rotation by
      their last successful pass, oldest first, and takes the first that has work to do. A run
      that failed is not a pass, so its task is still the oldest and is tried again next. A
      task with nothing on its worklist is passed over.
    </p>
    <ul class="rota" aria-label="The rotation">${ROTATION.map(t => `<li>${esc(t)}</li>`).join('')}</ul>${tasksHtml()}
    ${outside.length ? `<p class="method-p" style="margin-top:14px">
      ${WORDS[outside.length] ?? outside.length} more ${outside.length === 1 ? 'task is' : 'tasks are'} never picked automatically and ${outside.length === 1 ? 'runs' : 'run'} only when started by hand, to catch
      up in bulk: ${outside.map(t => `${esc(t)} (${TASKS[t].summary})`).join(', ')}. ${outside.length === 1 ? 'It goes' : 'They go'} through the same steps and the same gates.
    </p>` : ''}

    <h3 class="method-h" id="moves">What can move a score, and what cannot</h3>
    <div class="grid2">
      <div class="mcard">
        <h4>Moves it</h4>
        <ul class="moves">
          <li><b>Press, and its age.</b> A mention filed against an entry can lift critical
          reception by up to ${CRITICAL_BOOST_CAP.toFixed(1)} points and counts toward reputation. The lift halves
          every ${MENTION_HALF_LIFE_MONTHS} months and reputation counts a mention for ${COVERAGE_WINDOW_MONTHS}, so a score eases back when
          the press stops.</li>
          <li><b>Freshness.</b> A score loses ${pct(STALENESS_PER_WEEK, 1)} a week from the entry's last verification,
          up to ${pct(MAX_STALENESS_DECAY, 0)}. A status check or a verified set of addresses resets it.</li>
          <li><b>A fact filled in.</b> A founding year or a price tier filed for the first time
          changes reputation or value.</li>
          <li><b>A closure.</b> A closed entry leaves the ranking whatever it scores.</li>
          <li><b>A flag.</b> The attribute flags behind friction are set by hand, never by the
          agent.</li>
          <li><b>The formula.</b> A change to the scoring module raises its version, now
          ${ALGORITHM}. The record chart marks the week with a dashed rule, and the cards say the
          method moved rather than the pizzerias.</li>
        </ul>
        <p>Every computed factor is worked out again on each build, so all of this shows on
        the next publish.</p>
      </div>
      <div class="mcard">
        <h4>Does not move it</h4>
        <ul class="moves">
          <li><b>A rating the agent has set.</b> It is set once. The validator refuses a second
          proposal for that entry and no script changes the three values.</li>
          <li><b>The agent, directly.</b> It never writes a score, only records that have to
          pass the validator.</li>
          <li><b>A headline.</b> A story in the buzz list changes nothing until it is filed as
          a mention against an entry, and then only within the cap above.</li>
          <li><b>Readers and crowds.</b> No star average, review count or vote is collected,
          scored or shown.</li>
          <li><b>A run that fails.</b> The dataset and the site stay as they were.</li>
        </ul>
      </div>
    </div>`;

  return { factorCards, frictionRows, automation };
}
