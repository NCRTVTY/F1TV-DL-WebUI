export const menuFixture = {
  resultObj: {
    containers: [
      { metadata: { label: "2026 Season" }, actions: [{ uri: "/2.0/A/ENG/WEB_DASH/ALL/PAGE/100/ANONYMOUS/2" }] },
      { metadata: { label: "Archive" }, actions: [{ uri: "/2.0/A/ENG/WEB_DASH/ALL/PAGE/493/ANONYMOUS/2" }] }
    ]
  }
};

export const archiveFixture = {
  resultObj: {
    containers: [{
      retrieveItems: {
        resultObj: {
          containers: [{
            metadata: { title: "2025 Season", season: 2025, contentSubtype: "MEETING" },
            actions: [{ uri: "/2.0/A/ENG/WEB_DASH/ALL/PAGE/99/ANONYMOUS/2" }]
          }]
        }
      }
    }]
  }
};

export const seasonFixture = {
  resultObj: {
    containers: [{
      retrieveItems: {
        resultObj: {
          containers: [{
            id: "event-bundle",
            actions: [{ uri: "/2.0/A/ENG/WEB_DASH/ALL/PAGE/500/ANONYMOUS/2" }],
            metadata: {
              contentSubtype: "MEETING",
              season: 2026,
              pictureUrl: "event-image/landscape_web",
              emfAttributes: {
                VideoType: "meetings",
                Meeting_Number: "1",
                Meeting_Official_Name: "FORMULA 1 AUSTRALIAN GRAND PRIX 2026",
                Meeting_Country_Name: "Australia",
                Meeting_Start_Date: "2026-03-06T00:00:00+11:00",
                Meeting_End_Date: "2026-03-08T23:59:59+11:00",
                IsTestEvent: "false"
              }
            }
          }]
        }
      }
    }]
  }
};

function session(contentId: number, title: string, series: string, genre: string, season = 2026) {
  return {
    id: String(contentId),
    actions: [{ href: `/detail/${contentId}/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}?action=play` }],
    metadata: {
      contentId,
      title,
      titleBrief: title,
      contentSubtype: "REPLAY",
      season,
      duration: 7200,
      uiDuration: "02:00:00",
      pictureUrl: `${contentId}-image/landscape_web`,
      genres: [genre],
      emfAttributes: {
        Series: series,
        MeetingKey: "42",
        sessionStartDate: "2026-03-08T15:00:00+11:00",
        sessionEndTime: "2026-03-08T17:00:00+11:00",
        Meeting_Number: "1",
        Global_Meeting_Name: "Australian Grand Prix",
        Meeting_Country_Name: "Australia"
      }
    }
  };
}

export const eventFixture = {
  resultObj: {
    containers: [{
      metadata: { label: "Replays" },
      retrieveItems: {
        resultObj: {
          containers: [
            session(700, "2026 Australian Grand Prix", "FORMULA 1", "Race"),
            session(701, "Post-Race Show - Australia", "FORMULA 1", "Post-Race Show"),
            session(702, "2026 Australian GP - F2 Feature Race", "FORMULA 2", "Race"),
            session(703, "2025 Australian Grand Prix", "FORMULA 1", "Race", 2025)
          ]
        }
      }
    }]
  }
};

export const fixtureFetch = async (path: string): Promise<unknown> => {
  if (path.includes("/MENU/")) return menuFixture;
  if (path.includes("/PAGE/493/")) return archiveFixture;
  if (path.includes("/PAGE/100/")) return seasonFixture;
  if (path.includes("/PAGE/500/")) return eventFixture;
  throw new Error(`Unexpected fixture path: ${path}`);
};
