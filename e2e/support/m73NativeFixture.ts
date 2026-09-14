/** Explicitly synthetic mzML for real-provider M7.3 acceptance; no acquisition data. */
import { writeFileSync } from "node:fs";

export const M73_MZ = Array.from({ length: 12 }, (_, index) => 100 + index * 50);
export const M73_INTENSITY = [10, 35, -5, 65, 100, 42, 18, 75, 30, 19, 55, 8];
export const M73_SCAN_COUNT = 12;
function binary(values: number[], accession: string, name: string) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
  const text = bytes.toString("base64");
  return `<binaryDataArray encodedLength="${text.length}"><cvParam cvRef="MS" accession="MS:1000523" name="64-bit float"/>
    <cvParam cvRef="MS" accession="MS:1000576" name="no compression"/><cvParam cvRef="MS" accession="${accession}" name="${name}"/>
    <binary>${text}</binary></binaryDataArray>`;
}
export function writeM73NativeFixture(path: string) {
  const spectra = Array.from({ length: M73_SCAN_COUNT }, (_, index) => {
    const intensity = M73_INTENSITY.map(value => value * (index + 1));
    return `<spectrum index="${index}" id="controllerType=0 controllerNumber=1 scan=${index + 1}" defaultArrayLength="12">
      <cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="${index % 2 + 1}"/>
      <cvParam cvRef="MS" accession="MS:1000127" name="centroid spectrum"/>
      <cvParam cvRef="MS" accession="MS:1000130" name="positive scan"/>
      <cvParam cvRef="MS" accession="MS:1000285" name="total ion current" value="${intensity.reduce((a, b) => a + b, 0)}"/>
      <cvParam cvRef="MS" accession="MS:1000504" name="base peak m/z" value="300"/>
      <cvParam cvRef="MS" accession="MS:1000505" name="base peak intensity" value="${100 * (index + 1)}"/>
      <cvParam cvRef="MS" accession="MS:1000528" name="lowest observed m/z" value="100"/>
      <cvParam cvRef="MS" accession="MS:1000527" name="highest observed m/z" value="650"/>
      <scanList count="1"><cvParam cvRef="MS" accession="MS:1000795" name="no combination"/>
        <scan><cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="${index}" unitCvRef="UO" unitAccession="UO:0000031" unitName="minute"/></scan></scanList>
      <binaryDataArrayList count="2">${binary(M73_MZ, "MS:1000514", "m/z array")}${binary(intensity, "MS:1000515", "intensity array")}</binaryDataArrayList>
    </spectrum>`;
  }).join("\n");
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>
<mzML xmlns="http://psi.hupo.org/ms/mzml" id="MSCanvas-M73-synthetic" version="1.1.0">
  <cvList count="2"><cv id="MS" fullName="PSI-MS" version="4.1" URI="https://purl.obolibrary.org/obo/ms.obo"/>
    <cv id="UO" fullName="Unit Ontology" version="1" URI="https://purl.obolibrary.org/obo/uo.obo"/></cvList>
  <fileDescription><fileContent><cvParam cvRef="MS" accession="MS:1000580" name="MSn spectrum"/>
    <userParam name="Synthetic test input" value="Generated arithmetic values; no physical acquisition"/></fileContent></fileDescription>
  <softwareList count="1"><software id="MSCanvas-fixture" version="1"><cvParam cvRef="MS" accession="MS:1000799" name="custom unreleased software tool" value="MSCanvas M7.3 synthetic fixture"/></software></softwareList>
  <instrumentConfigurationList count="1"><instrumentConfiguration id="IC1"><componentList count="1"><analyzer order="1"><cvParam cvRef="MS" accession="MS:1000081" name="quadrupole"/></analyzer></componentList></instrumentConfiguration></instrumentConfigurationList>
  <dataProcessingList count="1"><dataProcessing id="DP1"><processingMethod order="0" softwareRef="MSCanvas-fixture"><cvParam cvRef="MS" accession="MS:1000544" name="Conversion to mzML"/></processingMethod></dataProcessing></dataProcessingList>
  <run id="synthetic-run" defaultInstrumentConfigurationRef="IC1"><spectrumList count="${M73_SCAN_COUNT}" defaultDataProcessingRef="DP1">${spectra}</spectrumList></run>
</mzML>\n`, "utf8");
}
