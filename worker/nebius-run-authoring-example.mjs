// Authored API example, never a generated recovery result or fallback tool.
// Kept as native source strings so JSON.stringify owns the wire escaping.
export const AUTHORING_EXAMPLE = Object.freeze({
  'index.html': String.raw`<!doctype html>
<html lang="en">
<head><title>Quantity example</title>
<style>body{margin:0;font-family:sans-serif}fieldset{min-inline-size:0}label,output{display:block}input,select,button{font:inherit;min-height:44px;max-width:100%;box-sizing:border-box}output{white-space:pre-wrap}</style>
</head>
<body>
<fieldset>
<legend>Illustrative quantity and add-ons</legend>
<label for="quantity">Quantity, 1 to 9</label>
<input id="quantity" type="text" inputmode="numeric" data-input-format="text" value="2">
<label for="addons">Add-ons</label>
<select id="addons" data-input-format="text">
<option value="none" selected>None</option>
<option value="label">Label</option>
<option value="wrap">Wrap</option>
<option value="both">Both</option>
</select>
<button id="reset" type="button">Reset</button>
</fieldset>
<output id="result" aria-label="Example total"></output>
<output id="error" aria-label="Input error"></output>
</body>
</html>`,
  'app.js': String.raw`function validate(values) {
  const raw = values.quantity;
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) {
    return {error:"Enter a whole quantity from 1 to 9."};
  }
  const quantity = Number(raw);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9) {
    return {error:"Enter a whole quantity from 1 to 9."};
  }
  if (!["none","label","wrap","both"].includes(values.addons)) {
    return {error:"Choose a listed add-on."};
  }
  return {error:"", quantity, addons:values.addons};
}
function resultPatches(values) {
  const checked = validate(values);
  if (checked.error) {
    return [{id:"result",text:""},{id:"error",text:checked.error}];
  }
  const label = checked.addons === "label" || checked.addons === "both";
  const wrap = checked.addons === "wrap" || checked.addons === "both";
  const total = checked.quantity + Number(label) + 2 * Number(wrap);
  return [{id:"result",text:"Total: " + total},{id:"error",text:""}];
}
function handleMessage(message) {
  if (message.type === "event" && message.event === "click" && message.id === "reset") {
    const preset = {quantity:"2", addons:"none"};
    return [
      {id:"quantity",value:preset.quantity},
      {id:"addons",value:preset.addons},
      ...resultPatches(preset)
    ];
  }
  return resultPatches(message.values);
}`,
  'checks.cjs': String.raw`// Shape, numbers and control values are exact; incidental prose is not.
function getPatch(patches, id) {
  assert(Array.isArray(patches));
  const matches = patches.filter(patch => patch && typeof patch === "object" && patch.id === id);
  assert.equal(matches.length, 1);
  return matches[0];
}
function expectResult(patches, total) {
  const resultPatch = getPatch(patches, "result");
  assert.deepEqual(Object.keys(resultPatch).sort(), ["id","text"]);
  const text = resultPatch.text;
  assert.equal(typeof text, "string");
  assert(text.length <= 40);
  const match = /^\s*total\s*:?\s*([0-9]{1,2})\s*\.?\s*$/i.exec(text);
  assert.notEqual(match, null);
  assert.equal(Number(match[1]), total);
  const errorPatch = getPatch(patches, "error");
  assert.deepEqual(Object.keys(errorPatch).sort(), ["id","text"]);
  assert.equal(errorPatch.text, "");
}
function expectResetInputs(patches) {
  const quantityPatch = getPatch(patches, "quantity");
  const addonsPatch = getPatch(patches, "addons");
  assert.deepEqual(Object.keys(quantityPatch).sort(), ["id","value"]);
  assert.deepEqual(Object.keys(addonsPatch).sort(), ["id","value"]);
  assert.equal(quantityPatch.value, "2");
  assert.equal(addonsPatch.value, "none");
}
function expectInputValuesUnchanged(patches, values) {
  for (const id of ["quantity","addons"]) {
    for (const patch of patches.filter(patch => patch && patch.id === id)) {
      if (Object.hasOwn(patch, "value")) assert.equal(patch.value, values[id]);
      if (id === "addons") assert(!Object.hasOwn(patch, "options"));
      assert.notEqual(patch.hidden, true);
      assert.notEqual(patch.disabled, true);
    }
  }
}
function expectInvalid(patches) {
  const resultPatch = getPatch(patches, "result");
  const errorPatch = getPatch(patches, "error");
  assert.deepEqual(Object.keys(resultPatch).sort(), ["id","text"]);
  assert.deepEqual(Object.keys(errorPatch).sort(), ["id","text"]);
  assert.equal(resultPatch.text, "");
  const errorText = errorPatch.text;
  assert.equal(typeof errorText, "string");
  assert.notEqual(errorText.trim(), "");
}
const starting = {quantity:"2",addons:"none"};
assert.deepEqual(validate(starting), {error:"",quantity:2,addons:"none"});
const initialMessage = {type:"init",values:starting};
const initialPatches = handleMessage(initialMessage);
expectResult(initialPatches, 2);
expectInputValuesUnchanged(initialPatches, starting);
for (const id of ["quantity","addons"]) {
  for (const event of ["input","change"]) {
    const message = {type:"event",event,id,values:starting};
    const patches = handleMessage(message);
    expectResult(patches, 2);
    expectInputValuesUnchanged(patches, starting);
  }
}
const exampleQuantityMin = 1, exampleQuantityMax = 9;
const expectedTotals = [["none",2],["label",3],["wrap",4],["both",5]];
for (const event of ["input","change"]) {
  for (const [addons,total] of expectedTotals) {
    const values = {quantity:"2",addons};
    const message = {type:"event",event,id:"addons",values};
    const patches = handleMessage(message);
    expectResult(patches, total);
    expectInputValuesUnchanged(patches, values);
  }
  for (const quantity of [String(exampleQuantityMin),String(exampleQuantityMax)]) {
    const values = {quantity,addons:"none"};
    assert.equal(validate(values).error, "");
    const message = {type:"event",event,id:"quantity",values};
    const patches = handleMessage(message);
    expectResult(patches, Number(quantity));
    expectInputValuesUnchanged(patches, values);
  }
  for (const quantity of [""," ","1.5","2x","-1","Infinity",String(exampleQuantityMin - 1),String(exampleQuantityMax + 1)]) {
    const values = {quantity,addons:"none"};
    const validation = validate(values);
    assert.equal(typeof validation.error, "string");
    assert.notEqual(validation.error.trim(), "");
    const message = {type:"event",event,id:"quantity",values};
    const patches = handleMessage(message);
    expectInvalid(patches);
    expectInputValuesUnchanged(patches, values);
  }
  const unknownValues = {quantity:"2",addons:"unknown"};
  const rejected = validate(unknownValues);
  assert.equal(typeof rejected.error, "string");
  assert.notEqual(rejected.error.trim(), "");
  const unknownMessage = {type:"event",event,id:"addons",values:unknownValues};
  const unknownPatches = handleMessage(unknownMessage);
  expectInvalid(unknownPatches);
  expectInputValuesUnchanged(unknownPatches, unknownValues);
  const correctedValues = {quantity:"3",addons:"both"};
  const correctedMessage = {type:"event",event,id:"quantity",values:correctedValues};
  const correctedPatches = handleMessage(correctedMessage);
  expectResult(correctedPatches, 6);
  expectInputValuesUnchanged(correctedPatches, correctedValues);
}
for (const values of [{quantity:"bad",addons:"unknown"},{quantity:"9",addons:"both"}]) {
  const message = {type:"event",event:"click",id:"reset",values};
  const patches = handleMessage(message);
  expectResult(patches, 2);
  expectResetInputs(patches);
}`,
});
