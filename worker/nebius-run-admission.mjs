import {RunProviderError} from './nebius-run-provider.mjs';
import {runPageContract,renderRunPreview} from './nebius-run-preview.mjs';
import {validateRunChecksSyntax} from './nebius-run-checks.mjs';

export function boundedRunMessage(error,fallback){
  const message=typeof error==='string'?error:error instanceof Error&&typeof error.message==='string'?error.message:fallback;
  return message.replace(/[\u0000-\u001f\u007f]/gu,' ').slice(0,500)||fallback;
}

// Shared static gate for live orchestration and offline retained-trace replay.
// No generated source is executed, and this function cannot submit work.
export async function validateGeneratedSource(files,requirements={}){
  const diagnostics=[];
  try{
    const page=runPageContract(files,requirements);
    const missing=page.elements.filter(element=>element.textValue&&element.format===null);
    if(missing.length)throw new TypeError('Every textual input needs an explicit data-input-format="text" or "json" declaration. Missing: '+missing.map(element=>element.id).join(', '));
    await renderRunPreview(files,requirements);
  }catch(error){
    if(!(error instanceof TypeError))throw error;
    diagnostics.push(boundedRunMessage(error,'The generated page could not be prepared for preview.').slice(0,280));
  }
  const pageRejected=diagnostics.length>0;
  try{validateRunChecksSyntax(files.find(file=>file.path==='checks.cjs')?.content);}
  catch(error){if(!(error instanceof TypeError))throw error;diagnostics.push(boundedRunMessage(error,'The generated checks could not be compiled.').slice(0,180));}
  if(diagnostics.length)throw new RunProviderError('invalid_model_output',diagnostics.join(' | '),false,pageRejected?'preview':'tool_checks');
}
