import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { SaxesParser } from 'saxes';
import WordExtractor from 'word-extractor';
import { limits } from './contracts.js';

export const maxWordBytes = 10 * 1024 * 1024;
const maxXmlBytes = 12 * 1024 * 1024;
const wordNamespaces = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);

async function docxBody(bytes) {
  const archive = await promisify(yauzl.fromBuffer)(bytes,{lazyEntries:true});
  try {
    for await (const entry of archive.eachEntry()) {
      if (entry.fileName !== 'word/document.xml') continue;
      if (entry.uncompressedSize > maxXmlBytes) throw Error('Word 正文部分过大');
      const stream = await archive.openReadStreamPromise(entry);
      const parser = new SaxesParser({xmlns:true});
      const parts = [];
      let inText = false;
      parser.on('doctype',()=>{throw Error('不支持带 DTD 的文档');});
      parser.on('opentag',tag=>{
        if (!wordNamespaces.has(tag.uri)) return;
        if (tag.local==='t') inText=true;
        if (tag.local==='tab') parts.push('\t');
        if (tag.local==='br' || tag.local==='cr') parts.push('\n');
      });
      parser.on('closetag',tag=>{
        if (!wordNamespaces.has(tag.uri)) return;
        if (tag.local==='t') inText=false;
        if (tag.local==='p' || tag.local==='tr') parts.push('\n');
        if (tag.local==='tc') parts.push('\t');
      });
      parser.on('text',value=>{if (inText) parts.push(value);});
      stream.setEncoding('utf8');
      for await (const chunk of stream) parser.write(chunk);
      parser.close();
      return parts.join('').trim();
    }
    throw Error('缺少正文');
  } finally { archive.close(); }
}

if (!isMainThread && workerData?.word) {
  try {
    const bytes = Buffer.from(workerData.bytes);
    let text;
    if (workerData.extension === '.docx') {
      text = await docxBody(bytes);
    } else {
      if (bytes.subarray(0,8).toString('hex') !== 'd0cf11e0a1b11ae1') throw Error('文件格式不匹配');
      const document = await new WordExtractor().extract(bytes);
      text = document.getBody({filterUnicode:false}).trim();
    }
    parentPort.postMessage({text:text.slice(0,limits.prd+1)});
  } catch { parentPort.postMessage({error:true}); }
}

export function extractWord(bytes,extension) {
  return new Promise((resolve,reject)=>{
    const worker = new Worker(new URL(import.meta.url),{
      workerData:{word:true,bytes,extension},resourceLimits:{maxOldGenerationSizeMb:96},
    });
    const fail = ()=>reject(Object.assign(Error('无法读取 Word 正文，请检查文件是否损坏、加密或格式不匹配'),{status:400}));
    const timer = setTimeout(()=>{fail();worker.terminate();},15000);
    worker.once('message',result=>result.error ? fail() : resolve(result.text));
    worker.once('error',fail);
    worker.once('exit',()=>{clearTimeout(timer);fail();});
  });
}
