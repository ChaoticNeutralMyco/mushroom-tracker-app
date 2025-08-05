import React, { useRef } from "react";
import { useReactToPrint } from "react-to-print";
import QRCode from "qrcode";

const LabelPrint = ({ grow }) => {
  const labelRef = useRef();

  const handlePrint = useReactToPrint({
    content: () => labelRef.current,
  });

  const generateQR = async (text) => {
    try {
      const url = await QRCode.toDataURL(text);
      return url;
    } catch (err) {
      console.error("QR generation failed:", err);
      return "";
    }
  };

  const qrData = JSON.stringify({
    growId: grow.id,
    strain: grow.strain,
    stage: grow.stage,
  });

  const [qrUrl, setQrUrl] = React.useState("");

  React.useEffect(() => {
    generateQR(qrData).then(setQrUrl);
  }, [qrData]);

  return (
    <div className="my-4">
      <div ref={labelRef} className="bg-white dark:bg-zinc-900 p-4 rounded border w-fit">
        <h2 className="text-lg font-bold">{grow.strain}</h2>
        <p className="text-sm">Stage: {grow.stage}</p>
        <p className="text-sm">Date: {grow.date?.substring(0, 10)}</p>
        {qrUrl && (
          <img src={qrUrl} alt="QR Code" className="mt-2 w-24 h-24 object-contain" />
        )}
      </div>
      <button
        onClick={handlePrint}
        className="mt-2 px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Print Label
      </button>
    </div>
  );
};

export default LabelPrint;
