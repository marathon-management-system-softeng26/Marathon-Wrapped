import {afterEach,describe,it,expect,vi} from "vitest";
import {exportWrapped} from "@/lib/exportWrapped";
import type {WrappedPayload} from "@/lib/wrappedPayload";
const payload:WrappedPayload={status:"unavailable",runner:{runner_id:"missing",name:"Adi",bib_number:null},reason:"missing_result"};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe("export failures",()=>{
 it("reports canvas unavailability without creating a download",async()=>{
  const createElement=vi.fn(()=>({getContext:()=>null}));
  vi.stubGlobal("document",{fonts:{load:async()=>{},ready:Promise.resolve()},createElement});
  await expect(exportWrapped(payload)).rejects.toThrow("Image export is unavailable");expect(createElement).toHaveBeenCalledTimes(1);
 });
 it("reports blob failure without attempting a download or writing race data",async()=>{
  const ctx={fillRect:vi.fn(),fillText:vi.fn(),beginPath:vi.fn(),roundRect:vi.fn(),fill:vi.fn()};
  const canvas={getContext:()=>ctx,toBlob:(callback:(blob:Blob|null)=>void)=>callback(null),width:0,height:0};
  const append=vi.fn();
  vi.stubGlobal("document",{fonts:{load:async()=>{},ready:Promise.resolve()},createElement:()=>canvas,body:{append}});
  await expect(exportWrapped(payload)).rejects.toThrow("Could not create image. Retry");expect(append).not.toHaveBeenCalled();expect(canvas.width).toBe(1080);expect(canvas.height).toBe(1350);
 });
});
