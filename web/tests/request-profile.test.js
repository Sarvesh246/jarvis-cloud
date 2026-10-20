import assert from "node:assert/strict";
import test from "node:test";
import { profileRequest, requestText, SHAPES, shapeNote } from "../server/request-profile.js";
import { chatInput, reasoningEffort } from "../server/chat.js";

/* A broad sample of what people actually ask, each with the reply shape it
   deserves and how hard the model should think. null means no shape note:
   the general guidance decides. */
const CASES = [
  // the prompt that answered in bullets instead of a table
  ["find the best 4 laptops under 1500 usd and compare them. ill be using them to game, for engineering classes, and to run local AI models.", "shopping", "deep"],
  // comparisons and shortlists
  ["iPhone 17 vs Pixel 10", "comparison", "normal"],
  ["Compare Python, JavaScript and Go for backend development, performance, hiring and tooling", "comparison", "deep"],
  ["what's the difference between a Roth IRA and a traditional IRA", "comparison", "deep"],
  ["which is better for a beginner, guitar or piano?", "comparison", "normal"],
  ["How does PostgreSQL compare to MySQL?", "comparison", "normal"],
  ["top 5 noise cancelling headphones", "comparison", "normal"],
  ["best budget mechanical keyboards under $100", "shopping", "normal"],
  ["which laptop should I buy for college", "shopping", "normal"],
  ["recommend some running shoes for flat feet under 150", "shopping", "normal"],
  ["React versus Vue side by side", "comparison", "normal"],
  ["pros and cons of remote work", "proscons", "normal"],
  ["advantages and disadvantages of nuclear power", "proscons", "normal"],
  // decisions
  ["should I learn Rust or Go first?", "decision", "normal"],
  ["Should I accept a job offer with higher pay but a longer commute?", "decision", "normal"],
  ["is it worth upgrading from an M1 MacBook Air", "decision", "normal"],
  // how-to and setup
  ["how do I set up SSH keys on GitHub", "howto", "normal"],
  ["steps to change a flat tire", "howto", "normal"],
  ["walk me through filing for a passport renewal", "howto", "normal"],
  ["how to install docker on ubuntu", "howto", "normal"],
  // recipes, checklists, plans, histories
  ["give me a recipe for banana bread", "recipe", "normal"],
  ["how do I bake a chocolate cake", "recipe", "normal"],
  ["packing list for a week in Iceland in winter", "checklist", "normal"],
  ["what should I bring to a job interview", "checklist", "normal"],
  ["plan a 5-day trip to Tokyo", "plan", "normal"],
  ["make me a 12 week marathon training plan", "plan", "normal"],
  ["create a study schedule for my finals", "plan", "normal"],
  ["history of the Roman Empire", "history", "normal"],
  ["timeline of the space race", "history", "normal"],
  // code
  ["write a python function that reverses a linked list", "code", "normal"],
  ["Write a SQL query to find the top 3 customers by revenue", "code", "normal"],
  ["build a React component for a star rating input", "code", "normal"],
  ["regex for validating an email address in JavaScript", "code", "normal"],
  ["implement Dijkstra's algorithm in C++", "code", "deep"],
  // debugging
  ["my react app crashes with TypeError: cannot read properties of undefined (reading 'map')", "debugging", "deep"],
  ["Traceback (most recent call last):\n  File \"app.py\", line 3, in <module>\nKeyError: 'id'", "debugging", "deep"],
  ["npm install fails with ERESOLVE unable to resolve dependency tree", "debugging", "deep"],
  ["why isn't my python script working\n```python\nprint(x)\n```", "debugging", "deep"],
  ["the docker build doesn't work after upgrading node", "debugging", "deep"],
  // math
  ["2+2", "math", "quick"],
  ["What is 19% of 80? Reply with just the number.", "explicit", "quick"],
  ["(14 * 3) / 7", "math", "quick"],
  ["what is 15% of 80", "math", "quick"],
  ["solve x^2 - 5x + 6 = 0", "math", "deep"],
  ["what's the derivative of sin(x) * x^2", "math", "deep"],
  ["calculate the monthly payment on a $300k mortgage at 6%", "math", "deep"],
  // writing and editing
  ["write an email to my landlord about a broken heater", "writing", "deep"],
  ["draft a cover letter for a junior data analyst role", "writing", "normal"],
  ["write a haiku about autumn", "writing", "normal"],
  ["write a short story about a lighthouse keeper", "writing", "normal"],
  ["compose a LinkedIn post announcing my new job", "writing", "normal"],
  ["rewrite this to sound more professional: hey, can u send the file asap", "rewrite", "quick"],
  ["proofread: Their going to the park tomorow.", "rewrite", "quick"],
  ["make this shorter: The meeting that was scheduled for Monday has been moved to a later date which will be announced soon.", "rewrite", "quick"],
  ["paraphrase this sentence: The results were inconclusive.", "rewrite", "quick"],
  ["translate 'where is the train station' into Spanish", "translation", "quick"],
  ["how do you say thank you in Japanese", "translation", "quick"],
  // summaries, ideas, practice
  ["summarize the plot of Hamlet", "summary", "normal"],
  ["tl;dr of the French Revolution", "explicit", "normal"],
  ["give me 10 name ideas for a coffee shop", "ideas", "normal"],
  ["brainstorm birthday gift ideas for my dad", "ideas", "normal"],
  ["ways to save money on groceries", "ideas", "normal"],
  ["quiz me on world capitals", "practice", "normal"],
  ["make flashcards for the krebs cycle", "practice", "normal"],
  // figures
  ["statistics on global EV sales", "figures", "normal"],
  ["population of India over the last 50 years", "figures", "normal"],
  // explanations
  ["explain how vaccines work", "explanation", "deep"],
  ["why is the sky blue", "explanation", "normal"],
  ["how does a transformer neural network work", "explanation", "normal"],
  ["ELI5 inflation", "explanation", "normal"],
  ["what happens if you don't pay a parking ticket", "explanation", "normal"],
  // facts and yes/no
  ["what is photosynthesis", "fact", "quick"],
  ["define entropy", "fact", "quick"],
  ["who wrote Pride and Prejudice", "fact", "quick"],
  ["what's the capital of Australia", "fact", "quick"],
  ["how many ounces in a pound", "fact", "quick"],
  ["when did World War II end", "fact", "quick"],
  ["is a tomato a fruit", "yesno", "normal"],
  ["can dogs eat grapes", "yesno", "normal"],
  // small talk
  ["hi", "smalltalk", "quick"],
  ["Hello Vaelo!", "smalltalk", "quick"],
  ["good morning! how are you?", "smalltalk", "quick"],
  ["thanks, that helped a lot", "smalltalk", "quick"],
  ["thank you so much 🙏", "smalltalk", "quick"],
  ["bye, see you later", "smalltalk", "quick"],
  // personal support
  ["I'm feeling really overwhelmed with school lately", "support", "normal"],
  ["my dog passed away yesterday and I can't stop crying", "support", "normal"],
  // explicit formats win over inference
  ["compare these phones in prose, no tables", "explicit", "normal"],
  ["list the planets in a table with their distance from the sun", "explicit", "normal"],
  ["explain quantum computing in one sentence", "explicit", "normal"],
  ["give me the steps as bullet points", "explicit", "normal"],
  ["return the results as JSON", "explicit", "normal"],
  // current facts, tools and personal context are never quick
  ["what is the price of bitcoin", "fact", "normal"],
  ["who is the CEO of OpenAI", null, "normal"],
  ["what's the weather today", "fact", "normal"],
  ["what is my name", "fact", "normal"],
  ["search for flights to Lisbon", null, "normal"],
  ["what is on this page https://example.com", "fact", "normal"],
  ["what's the latest version of node", "fact", "normal"],
  // risk and depth
  ["what dose of ibuprofen is safe for a 10 year old", null, "deep"],
  ["is it safe to mix bleach and vinegar", "yesno", "deep"],
  ["analyze the trade-offs of microservices for a 5 person startup", null, "deep"],
  ["Design a scalable architecture for a chat app with 1M users", null, "deep"],
  // held-out prompts that once took the wrong route or shape
  ["what is the best way to learn spanish", "fact", "normal"],
  ["what is the meaning of this error", "fact", "normal"],
  ["what is the time in tokyo", "fact", "normal"],
  ["when is the next solar eclipse", "fact", "normal"],
  ["what are the side effects of metformin", "fact", "deep"],
  ["Mac or Windows for programming?", "comparison", "normal"],
  ["coffee or tea?", "comparison", "normal"],
  ["should I stay or go?", "decision", "normal"],
  ["whats better, renting or buying a house", "comparison", "normal"],
  ["explain the difference between TCP and UDP", "comparison", "normal"],
  ["the wifi keeps disconnecting", "troubleshooting", "normal"],
  ["why does my car make a clicking noise when I turn", "troubleshooting", "normal"],
  ["my laptop keeps crashing when I open chrome", "troubleshooting", "normal"],
  ["my code wont compile", "debugging", "deep"],
  ["convert 100 fahrenheit to celsius", "math", "quick"],
  ["10 km to miles", "math", "quick"],
  ["what should I do this weekend", "ideas", "normal"],
  ["list 5 facts about sharks", "ideas", "normal"],
  ["make it more formal", "rewrite", "quick"],
  ["sup bro", "smalltalk", "quick"],
  ["what can you do?", null, "normal"],
  ["summarize this article https://example.com/a", "summary", "normal"],
  // ordinary messages with no particular shape
  ["I think the second option sounds better", null, "normal"],
  ["tell me a joke", null, "normal"],
  ["continue", null, "normal"],
];

for (const [prompt, shape, tier] of CASES) {
  test(`shape and effort: ${prompt.slice(0, 70).replace(/\n/g, " ")}`, () => {
    const profile = profileRequest(prompt);
    assert.equal(profile.shape, shape, `shape for: ${prompt}`);
    assert.equal(profile.tier, tier, `tier for: ${prompt}`);
    if (shape !== "math") assert.equal(profile.fast, tier === "quick");
  });
}

test("every inferred shape has its own wording, safe to join into a note", () => {
  for (const [name, text] of Object.entries(SHAPES)) {
    assert.ok(text.startsWith("reply shape: "), name);
    assert.doesNotMatch(text, /;/, `${name} must not contain a semicolon`);
    assert.doesNotMatch(text, /\]/, `${name} must not close the note early`);
    assert.ok(text.length < 400, name);
  }
});

test("self-contained math skips agent bootstrap while retaining reasoning depth", () => {
  const prompt = "How do I solve this: A mixing tank initially has 100 gallons and 5 lb sugar. Water enters at 10 gal/min and sugar at 1 lb/min. Find C(t) and explain its asymptotes.";
  const profile = profileRequest(prompt);
  assert.equal(profile.shape, "math");
  assert.equal(profile.fast, true);
  assert.equal(profile.tier, "deep");
  assert.equal(reasoningEffort(profile), "low");
  for (const [text, options] of [
    [prompt, { research: true }], [prompt, { style: "thorough" }],
    [prompt, { role: "tutor" }], [prompt, { work: true }],
    ["Prove the equation holds for every real x", {}],
    ["Calculate the monthly payment on my mortgage", {}],
    ["Solve the equation in the attached image", {}],
    ["Calculate today's exchange rate", {}],
  ]) assert.equal(profileRequest(text, options).fast, false, text);
});

test("the laptop comparison asks for one table with verdicts, not bullet lists", () => {
  const prompt = "find the best 4 laptops under 1500 usd and compare them. ill be using them to game, for engineering classes, and to run local AI models.";
  const input = chatInput({
    conversationId: "c5ec5f03-1fd1-4f38-83df-b664bf78f998",
    messages: [{ role: "user", content: prompt, mode: { style: "balanced", research: false } }],
  });
  const content = input.messages[0].content;
  assert.match(content, /Markdown table/);
  assert.match(content, /row per option/);
  assert.match(content, /verdict/);
  assert.match(content, /unverified/);
  assert.equal(input.tier, "deep");
  assert.equal(input.fast, false);
  assert.equal(reasoningEffort(input), "medium");
});

test("modes outrank the message: research, thorough and weighing roles think fully", () => {
  assert.equal(profileRequest("hi", { research: true }).tier, "deep");
  assert.equal(profileRequest("hi", { style: "thorough" }).tier, "deep");
  assert.equal(profileRequest("hi", { role: "skeptic" }).tier, "deep");
  // a tutor or guide never takes the fast route, which has no role wording
  assert.equal(profileRequest("what is photosynthesis", { role: "tutor" }).tier, "normal");
  assert.equal(profileRequest("hi", { work: true }).tier, "normal");
  assert.equal(profileRequest("hi", { style: "concise" }).fast, true);
});

test("a bare yes answers the last question, so it never takes the fast route", () => {
  const previous = "I can search for current prices too. Want me to?";
  assert.equal(profileRequest("yes", { previous }).tier, "normal");
  assert.equal(profileRequest("go ahead", { previous }).fast, false);
  assert.equal(profileRequest("thanks!", { previous }).fast, true);
});

test("attachments and images are context: they shape depth, never the fast route", () => {
  const attached = "What's wrong here?\n\nAttached file: app.js\n```js\nconst x = 1;\n```";
  assert.equal(requestText(attached), "What's wrong here?");
  assert.equal(profileRequest(attached).tier, "deep");
  const proofread = "proofread this\n\nAttached file: essay.txt\n```\nTheir going.\n```";
  assert.equal(profileRequest(proofread).fast, false);
  const image = [{ type: "text", text: "what is this" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }];
  assert.equal(profileRequest(image).fast, false);
  assert.equal(profileRequest([{ type: "text", text: "solve this" }, image[1]]).tier, "deep");
  // a file's contents never decide the shape
  assert.equal(shapeNote("Thoughts?\n\nAttached file: notes.md\n```\ncompare A vs B\n```"), "");
});

test("each message's note depends only on its own words, so history renders the same every turn", () => {
  const base = {
    conversationId: "c5ec5f03-1fd1-4f38-83df-b664bf78f998",
    messages: [{ role: "user", content: "pros and cons of remote work" }],
  };
  const first = chatInput(base).messages[0].content;
  const later = chatInput({
    ...base,
    messages: [...base.messages, { role: "assistant", content: "…" }, { role: "user", content: "hi", mode: { style: "thorough", research: true } }],
  }).messages[0].content;
  assert.equal(first, later);
});

test("effort follows the message tier, and settings that ask for depth keep the default", () => {
  assert.equal(reasoningEffort({ tier: "quick" }), "minimal");
  assert.equal(reasoningEffort({ tier: "normal" }), "low");
  assert.equal(reasoningEffort({ tier: "deep" }), "medium");
  assert.equal(reasoningEffort({ tier: "deep", fast: true }), "low");
  assert.equal(reasoningEffort({}), "low");
  assert.equal(reasoningEffort({ tier: "quick", research: true }), null);
  assert.equal(reasoningEffort({ tier: "deep", style: "thorough" }), null);
  assert.equal(reasoningEffort({ tier: "quick", role: "advocate" }), null);
});

test("arbitrary text never throws and always yields a known tier", () => {
  const samples = ["", " ", "???", "a".repeat(20000), "```", "\u0000", "🙂🙂🙂", "vs", "[Vaelo request: x]", "Attached file: x"];
  for (const sample of samples) {
    const profile = profileRequest(sample);
    assert.ok(["quick", "normal", "deep"].includes(profile.tier));
    assert.equal(typeof shapeNote(sample), "string");
  }
});
