// The team. Photos live in Frontend/public/contributors/ (square-ish JPG/PNG works best).
// If a photo file is missing, the page shows a neutral placeholder instead.
export type Contributor = { name: string; studentId?: string; role?: string; image?: string; link?: string };

export const CONTRIBUTORS: Contributor[] = [
  { name: "Syed Sheraz Anjum", studentId: "25240017", image: "/contributors/syed-sheraz-anjum.jpg" },
  { name: "Saif ur Rehman", studentId: "24280071", image: "/contributors/saif-ur-rehman.jpg" },
  { name: "Hussnain Ali Murtaza", studentId: "25280069" },
  { name: "Junaid Tariq", studentId: "25280044" },
];
